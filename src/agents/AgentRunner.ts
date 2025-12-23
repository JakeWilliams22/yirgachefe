/**
 * Core agent execution loop.
 * Handles the prompt → LLM → tool calls → repeat cycle.
 * Supports checkpointing and resuming for crash recovery.
 */

import {
  AnthropicClient,
  AnthropicError,
  extractTextContent,
  extractToolUses,
  createToolResult,
  createToolResultWithImage,
  type ContentBlock,
  type Message,
} from '../services/anthropic';
import {
  type AgentConfig,
  type AgentEvent,
  type AgentEventListener,
  type AgentResult,
  type AgentExecutionState,
  type Discovery,
  type Tool,
  toolToDefinition,
} from './types';

const DEFAULT_MAX_ITERATIONS = 50;
const MAX_CONSECUTIVE_ERRORS = 3;

export interface CheckpointData {
  messages: Message[];
  discoveries: Discovery[];
  tokenUsage: { input: number; output: number };
  iteration: number;
}

export interface AgentRunnerOptions {
  /** Callback to save checkpoint state */
  onCheckpoint?: (data: CheckpointData) => void;
  /** Interval between checkpoints (in iterations) */
  checkpointInterval?: number;
}

export class AgentRunner {
  private config: AgentConfig;
  private client: AnthropicClient;
  private listeners: AgentEventListener[] = [];
  private abortController: AbortController | null = null;
  private options: AgentRunnerOptions;

  constructor(
    config: AgentConfig,
    client: AnthropicClient,
    options: AgentRunnerOptions = {}
  ) {
    this.config = config;
    this.client = client;
    this.options = {
      checkpointInterval: 3, // Checkpoint every 3 iterations by default
      ...options,
    };

    // Subscribe to rate limit events from the client
    client.onRateLimit((event) => {
      if (event.type === 'waiting') {
        this.emit({
          type: 'rate_limit',
          waiting: true,
          waitMs: event.waitMs,
          message: event.message,
          timestamp: Date.now(),
          usage: event.currentUsage !== undefined
            ? {
                currentUsage: event.currentUsage,
                limit: event.limit || 0,
                utilizationPercent: event.limit
                  ? Math.round((event.currentUsage / event.limit) * 100)
                  : 0,
              }
            : undefined,
        });
      } else if (event.type === 'resumed') {
        this.emit({
          type: 'rate_limit',
          waiting: false,
          message: event.message,
        });
      } else if (event.type === 'usage_update') {
        this.emit({
          type: 'rate_limit',
          waiting: false,
          usage: {
            currentUsage: event.currentUsage || 0,
            limit: event.limit || 0,
            utilizationPercent: event.limit
              ? Math.round(((event.currentUsage || 0) / event.limit) * 100)
              : 0,
          },
        });
      }
    });
  }

  /**
   * Subscribe to agent events.
   */
  on(listener: AgentEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Emit an event to all listeners.
   */
  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('Error in agent event listener:', e);
      }
    }
  }

  /**
   * Stop the current execution.
   */
  stop(): void {
    this.abortController?.abort();
  }

  /**
   * Save a checkpoint if callback is configured.
   */
  private saveCheckpoint(state: AgentExecutionState, iteration: number): void {
    if (this.options.onCheckpoint) {
      this.options.onCheckpoint({
        messages: state.messages,
        discoveries: state.discoveries,
        tokenUsage: state.tokenUsage,
        iteration,
      });
    }
  }

  /**
   * Run the agent with the given initial prompt.
   */
  async run(initialPrompt: string): Promise<AgentResult> {
    const state: AgentExecutionState = {
      status: 'running',
      messages: [],
      discoveries: [],
      tokenUsage: { input: 0, output: 0 },
    };

    // Add initial user message
    state.messages.push({
      role: 'user',
      content: initialPrompt,
    });

    return this.executeLoop(state, 0, initialPrompt);
  }

  /**
   * Resume from a checkpoint.
   */
  async resume(checkpoint: CheckpointData): Promise<AgentResult> {
    const state: AgentExecutionState = {
      status: 'running',
      messages: checkpoint.messages,
      discoveries: checkpoint.discoveries,
      tokenUsage: checkpoint.tokenUsage,
    };

    this.emit({ type: 'status_change', status: 'running', message: 'Resuming...' });

    // Emit existing discoveries so UI shows them
    for (const discovery of state.discoveries) {
      this.emit({ type: 'discovery', discovery });
    }

    return this.executeLoop(state, checkpoint.iteration, null);
  }

  /**
   * Main execution loop.
   */
  private async executeLoop(
    state: AgentExecutionState,
    startIteration: number,
    initialPrompt: string | null
  ): Promise<AgentResult> {
    this.abortController = new AbortController();

    this.emit({ type: 'status_change', status: 'running' });

    if (initialPrompt) {
      this.emit({ type: 'message', role: 'user', content: initialPrompt });
    }

    const toolDefinitions = this.config.tools.map(toolToDefinition);
    const maxIterations = this.config.maxIterations || DEFAULT_MAX_ITERATIONS;
    let iteration = startIteration;
    let consecutiveErrors = 0;

    try {
      while (iteration < maxIterations) {
        if (this.abortController.signal.aborted) {
          // Save checkpoint before stopping
          this.saveCheckpoint(state, iteration);
          throw new Error('Agent execution was stopped');
        }

        iteration++;

        // Checkpoint periodically
        if (
          this.options.checkpointInterval &&
          iteration % this.options.checkpointInterval === 0
        ) {
          this.saveCheckpoint(state, iteration);
        }

        try {
          // Call the LLM
          const response = await this.client.chat({
            system: this.config.systemPrompt,
            messages: state.messages,
            maxTokens: this.config.maxTokens || 0,
            tools: toolDefinitions,
          });

          // Reset error counter on success
          consecutiveErrors = 0;

          state.currentResponse = response;
          state.tokenUsage.input += response.usage.input_tokens;
          state.tokenUsage.output += response.usage.output_tokens;

          // Extract text content (agent's thinking/response)
          const textContent = extractTextContent(response);
          if (textContent) {
            this.emit({ type: 'thinking', text: textContent });
          }

          // Check if we're done (no tool use)
          if (response.stop_reason === 'end_turn') {
            // Add assistant message to history
            state.messages.push({
              role: 'assistant',
              content: response.content,
            });

            this.emit({
              type: 'message',
              role: 'assistant',
              content: textContent,
            });

            // Agent is done
            state.status = 'complete';
            this.emit({ type: 'status_change', status: 'complete' });

            // Clear checkpoint on successful completion
            this.saveCheckpoint(state, iteration);

            const result: AgentResult = {
              success: true,
              summary: textContent,
              discoveries: state.discoveries,
              conversationHistory: state.messages,
              tokenUsage: state.tokenUsage,
            };

            this.emit({ type: 'complete', result });
            return result;
          }

          // Handle tool calls
          if (response.stop_reason === 'tool_use') {
            const toolUses = extractToolUses(response);

            // Add assistant message with tool calls
            state.messages.push({
              role: 'assistant',
              content: response.content,
            });

            // Execute each tool and collect results
            const toolResults: ContentBlock[] = [];

            for (const toolUse of toolUses) {
              this.emit({
                type: 'tool_call',
                toolName: toolUse.name,
                input: toolUse.input,
              });

              const tool = this.findTool(toolUse.name);
              if (!tool) {
                const result = createToolResult(
                  toolUse.id,
                  `Unknown tool: ${toolUse.name}`,
                  true
                );
                toolResults.push(result);
                continue;
              }

              try {
                const result = await tool.execute(toolUse.input);

                this.emit({
                  type: 'tool_result',
                  toolName: toolUse.name,
                  result,
                });

                // Check for discoveries in the result
                this.extractDiscoveries(toolUse.name, toolUse.input, result, state);

                // Check if result includes an image (for vision analysis)
                const resultData = result.data as Record<string, unknown> | null;
                const includesImage =
                  resultData &&
                  typeof resultData === 'object' &&
                  'includeImage' in resultData &&
                  resultData.includeImage === true &&
                  'dataUrl' in resultData &&
                  typeof resultData.dataUrl === 'string';

                if (includesImage && resultData) {
                  toolResults.push(
                    createToolResultWithImage(
                      toolUse.id,
                      result.output,
                      resultData.dataUrl as string,
                      !result.success
                    )
                  );
                } else {
                  toolResults.push(
                    createToolResult(toolUse.id, result.output, !result.success)
                  );
                }
              } catch (error) {
                const errorMessage = `Tool execution error: ${(error as Error).message}`;
                this.emit({ type: 'error', error: errorMessage });
                toolResults.push(createToolResult(toolUse.id, errorMessage, true));
              }
            }

            // Add tool results as user message
            state.messages.push({
              role: 'user',
              content: toolResults,
            });
          }
        } catch (error) {
          consecutiveErrors++;

          // Save checkpoint on error
          this.saveCheckpoint(state, iteration);

          const isRetryable =
            error instanceof AnthropicError &&
            (error.isRateLimited || error.isOverloaded || error.status >= 500);

          if (isRetryable && consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
            // Emit error but continue
            this.emit({
              type: 'error',
              error: `API error (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${(error as Error).message}. Retrying...`,
            });
            // Wait before retry (exponential backoff)
            await this.sleep(Math.pow(2, consecutiveErrors) * 1000);
            iteration--; // Don't count this as an iteration
            continue;
          }

          // Non-retryable error or too many consecutive errors
          throw error;
        }
      }

      // Max iterations reached
      this.saveCheckpoint(state, iteration);
      state.status = 'error';
      state.error = 'Maximum iterations reached';
      this.emit({
        type: 'status_change',
        status: 'error',
        message: state.error,
      });
      this.emit({ type: 'error', error: state.error });

      return {
        success: false,
        summary: 'Agent reached maximum iterations without completing.',
        discoveries: state.discoveries,
        conversationHistory: state.messages,
        tokenUsage: state.tokenUsage,
      };
    } catch (error) {
      // Save checkpoint on any error
      this.saveCheckpoint(state, iteration);

      state.status = 'error';
      state.error = (error as Error).message;
      this.emit({
        type: 'status_change',
        status: 'error',
        message: state.error,
      });
      this.emit({ type: 'error', error: state.error });

      return {
        success: false,
        summary: `Agent error: ${state.error}`,
        discoveries: state.discoveries,
        conversationHistory: state.messages,
        tokenUsage: state.tokenUsage,
      };
    }
  }

  private findTool(name: string): Tool | undefined {
    return this.config.tools.find((t) => t.name === name);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract discoveries from tool results.
   */
  private extractDiscoveries(
    toolName: string,
    input: unknown,
    result: { success: boolean; output: string; data?: unknown },
    state: AgentExecutionState
  ): void {
    if (!result.success) return;

    const inputObj = input as Record<string, unknown>;

    // Track directory listings as discoveries
    if (toolName === 'list_directory' && result.data) {
      const entries = result.data as Array<{ name: string; kind: string; path: string }>;

      for (const entry of entries) {
        const discovery: Discovery = {
          id: `${entry.kind}-${entry.path}`,
          type: entry.kind === 'directory' ? 'directory' : 'file',
          path: entry.path,
          description: `${entry.kind === 'directory' ? 'Directory' : 'File'}: ${entry.name}`,
          timestamp: new Date(),
        };

        // Only add if not already discovered
        if (!state.discoveries.find((d) => d.id === discovery.id)) {
          state.discoveries.push(discovery);
          this.emit({ type: 'discovery', discovery });
        }
      }
    }

    // Track file reads as data type discoveries
    if (toolName === 'read_file' && result.data) {
      const data = result.data as {
        content?: string;
        info?: { type: string };
        format?: {
          fileType: string;
          columns?: string[];
          jsonStructure?: string;
          delimiter?: string;
        };
      };
      const path = inputObj.path as string;

      // Use the enhanced format information from the tool
      if (data.format) {
        const discovery: Discovery = {
          id: `data-type-${path}`,
          type: 'data_type',
          path,
          description: `${data.format.fileType} file: ${path}${data.format.columns ? ` with ${data.format.columns.length} columns` : ''}`,
          metadata: {
            fileType: data.format.fileType,
            columns: data.format.columns,
            jsonStructure: data.format.jsonStructure,
            delimiter: data.format.delimiter,
          },
          timestamp: new Date(),
        };

        if (!state.discoveries.find((d) => d.id === discovery.id)) {
          state.discoveries.push(discovery);
          this.emit({ type: 'discovery', discovery });
        }
      } else if (data.content) {
        // Fallback to old method if format info not available
        const dataType = identifyDataType(data.content, path);
        if (dataType) {
          const discovery: Discovery = {
            id: `data-type-${path}`,
            type: 'data_type',
            path,
            description: `${dataType.type} data in ${path}`,
            metadata: dataType.metadata,
            timestamp: new Date(),
          };

          if (!state.discoveries.find((d) => d.id === discovery.id)) {
            state.discoveries.push(discovery);
            this.emit({ type: 'discovery', discovery });
          }
        }
      }
    }
  }
}

/**
 * Try to identify the type of data in a file.
 */
function identifyDataType(
  content: string,
  path: string
): { type: string; metadata?: Record<string, unknown> } | null {
  const trimmed = content.trim();

  // JSON
  if (
    (trimmed.startsWith('{') && trimmed.includes('}')) ||
    (trimmed.startsWith('[') && trimmed.includes(']'))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      const isArray = Array.isArray(parsed);
      return {
        type: 'JSON',
        metadata: {
          isArray,
          topLevelKeys: isArray
            ? undefined
            : Object.keys(parsed).slice(0, 10),
          arrayLength: isArray ? (parsed as unknown[]).length : undefined,
        },
      };
    } catch {
      // Not valid JSON
    }
  }

  // CSV (has commas and multiple lines)
  if (path.endsWith('.csv') || (trimmed.includes(',') && trimmed.includes('\n'))) {
    const lines = trimmed.split('\n');
    if (lines.length > 1) {
      const firstLine = lines[0];
      const columns = firstLine.split(',').map((c) => c.trim());
      return {
        type: 'CSV',
        metadata: {
          columns,
          rowCount: lines.length - 1,
        },
      };
    }
  }

  return null;
}
