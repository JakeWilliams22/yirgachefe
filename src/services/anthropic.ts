/**
 * Browser-based Anthropic API client.
 * Makes direct calls to Claude API with user-provided API key.
 * Includes smart rate limiting to avoid 429 errors.
 */

import { RateLimiter, type RateLimitListener } from './rateLimiter';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;
const MAX_RETRIES = 3;

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ImageSource {
  type: 'base64';
  media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  data: string;
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
  source?: ImageSource;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  cache_control?: { type: 'ephemeral' };
}

export interface SystemMessage {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface ChatRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  system?: string | SystemMessage[];
  maxTokens?: number;
  model?: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ChatResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: (TextBlock | ToolUseBlock)[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface StreamEvent {
  type: string;
  index?: number;
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
  };
  content_block?: {
    type: string;
    id?: string;
    name?: string;
    text?: string;
  };
  message?: ChatResponse;
}

export interface AnthropicClientOptions {
  apiKey: string;
  model?: string;
  enableRateLimiting?: boolean;
}

export class AnthropicClient {
  private apiKey: string;
  private model: string;
  private rateLimiter: RateLimiter | null = null;

  constructor(apiKey: string, model?: string);
  constructor(options: AnthropicClientOptions);
  constructor(apiKeyOrOptions: string | AnthropicClientOptions, model?: string) {
    if (typeof apiKeyOrOptions === 'string') {
      this.apiKey = apiKeyOrOptions;
      this.model = model || DEFAULT_MODEL;
      // Enable rate limiting by default
      this.rateLimiter = new RateLimiter();
    } else {
      this.apiKey = apiKeyOrOptions.apiKey;
      this.model = apiKeyOrOptions.model || DEFAULT_MODEL;
      if (apiKeyOrOptions.enableRateLimiting !== false) {
        this.rateLimiter = new RateLimiter();
      }
    }
  }

  /**
   * Subscribe to rate limit events (waiting, resumed, usage updates).
   */
  onRateLimit(listener: RateLimitListener): () => void {
    if (!this.rateLimiter) {
      return () => {};
    }
    return this.rateLimiter.on(listener);
  }

  /**
   * Get current rate limit status.
   */
  getRateLimitStatus() {
    if (!this.rateLimiter) {
      return null;
    }
    return this.rateLimiter.getStatus();
  }

  /**
   * Send a chat request and get a complete response.
   * Includes automatic retry logic for rate limits (using retry-after header).
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.makeRequest(request);

        // Record actual usage including cache tokens
        if (this.rateLimiter) {
          this.rateLimiter.recordUsage(
            response.usage.input_tokens,
            response.usage.output_tokens,
            response.usage.cache_creation_input_tokens,
            response.usage.cache_read_input_tokens
          );
        }

        return response;
      } catch (error) {
        lastError = error as Error;

        if (error instanceof AnthropicError) {
          // Handle rate limiting - require retry-after header
          if (error.isRateLimited && error.retryAfterMs && this.rateLimiter) {
            await this.rateLimiter.handleRateLimitError(error.retryAfterMs);
            continue; // Retry
          }

          // Handle overloaded (529) - wait and retry
          if (error.isOverloaded) {
            const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
            await this.sleep(waitTime);
            continue; // Retry
          }

          // Don't retry auth errors or other client errors
          if (error.status >= 400 && error.status < 500 && error.status !== 429) {
            throw error;
          }
        }

        // For other errors, use exponential backoff
        if (attempt < MAX_RETRIES - 1) {
          const waitTime = Math.pow(2, attempt) * 1000;
          await this.sleep(waitTime);
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Make the actual API request.
   */
  private async makeRequest(request: ChatRequest): Promise<ChatResponse> {
    // Enable prompt caching by converting system to array format and adding cache_control
    let system: string | SystemMessage[] | undefined = request.system;
    if (typeof request.system === 'string') {
      system = [
        {
          type: 'text',
          text: request.system,
          cache_control: { type: 'ephemeral' },
        },
      ];
    }

    // Add cache_control to the last tool for optimal caching
    let tools = request.tools;
    if (tools && tools.length > 0) {
      tools = [...tools];
      tools[tools.length - 1] = {
        ...tools[tools.length - 1],
        cache_control: { type: 'ephemeral' },
      };
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: request.model || this.model,
        max_tokens: request.maxTokens || MAX_TOKENS,
        system,
        messages: request.messages,
        tools,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const retryAfter = response.headers.get('retry-after');
      throw new AnthropicError(
        error.error?.message || `API request failed: ${response.status}`,
        response.status,
        error.error?.type,
        retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined
      );
    }

    return response.json();
  }

  /**
   * Send a chat request with streaming response.
   * Yields events as they arrive.
   */
  async *chatStream(request: ChatRequest): AsyncGenerator<StreamEvent> {
    // Enable prompt caching by converting system to array format and adding cache_control
    let system: string | SystemMessage[] | undefined = request.system;
    if (typeof request.system === 'string') {
      system = [
        {
          type: 'text',
          text: request.system,
          cache_control: { type: 'ephemeral' },
        },
      ];
    }

    // Add cache_control to the last tool for optimal caching
    let tools = request.tools;
    if (tools && tools.length > 0) {
      tools = [...tools];
      tools[tools.length - 1] = {
        ...tools[tools.length - 1],
        cache_control: { type: 'ephemeral' },
      };
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: request.model || this.model,
        max_tokens: request.maxTokens || MAX_TOKENS,
        system,
        messages: request.messages,
        tools,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const retryAfter = response.headers.get('retry-after');
      throw new AnthropicError(
        error.error?.message || `API request failed: ${response.status}`,
        response.status,
        error.error?.type,
        retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheCreationTokens = 0;
    let totalCacheReadTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              // Record usage at the end of stream
              if (this.rateLimiter && (totalInputTokens || totalOutputTokens)) {
                this.rateLimiter.recordUsage(
                  totalInputTokens,
                  totalOutputTokens,
                  totalCacheCreationTokens || undefined,
                  totalCacheReadTokens || undefined
                );
              }
              return;
            }

            try {
              const event = JSON.parse(data) as StreamEvent;

              // Track usage from message_delta events
              if (event.type === 'message_delta' && event.message?.usage) {
                totalInputTokens = event.message.usage.input_tokens || totalInputTokens;
                totalOutputTokens = event.message.usage.output_tokens || totalOutputTokens;
                totalCacheCreationTokens = event.message.usage.cache_creation_input_tokens || totalCacheCreationTokens;
                totalCacheReadTokens = event.message.usage.cache_read_input_tokens || totalCacheReadTokens;
              }

              // Track usage from message_start events
              if (event.type === 'message_start' && event.message?.usage) {
                totalInputTokens = event.message.usage.input_tokens;
                totalCacheCreationTokens = event.message.usage.cache_creation_input_tokens || 0;
                totalCacheReadTokens = event.message.usage.cache_read_input_tokens || 0;
              }

              yield event;
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      // Record usage if stream ended without [DONE]
      if (this.rateLimiter && (totalInputTokens || totalOutputTokens)) {
        this.rateLimiter.recordUsage(
          totalInputTokens,
          totalOutputTokens,
          totalCacheCreationTokens || undefined,
          totalCacheReadTokens || undefined
        );
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Test if the API key is valid.
   */
  async validateApiKey(): Promise<boolean> {
    try {
      // Temporarily disable rate limiting for validation
      const limiter = this.rateLimiter;
      this.rateLimiter = null;

      await this.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 10,
      });

      this.rateLimiter = limiter;
      return true;
    } catch (error) {
      if (error instanceof AnthropicError && error.status === 401) {
        return false;
      }
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class AnthropicError extends Error {
  status: number;
  type?: string;
  retryAfterMs?: number;

  constructor(message: string, status: number, type?: string, retryAfterMs?: number) {
    super(message);
    this.name = 'AnthropicError';
    this.status = status;
    this.type = type;
    this.retryAfterMs = retryAfterMs;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isOverloaded(): boolean {
    return this.status === 529;
  }
}

/**
 * Create tool result content block for sending back to Claude.
 */
export function createToolResult(
  toolUseId: string,
  result: string,
  isError: boolean = false
): ContentBlock {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: result,
    is_error: isError,
  };
}

/**
 * Create tool result with image for vision analysis.
 */
export function createToolResultWithImage(
  toolUseId: string,
  text: string,
  imageDataUrl: string,
  isError: boolean = false
): ContentBlock {
  // Extract base64 data and media type from data URL
  const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid image data URL format');
  }

  const mediaType = match[1] as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  const base64Data = match[2];

  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: [
      {
        type: 'text',
        text,
      },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64Data,
        },
      },
    ],
    is_error: isError,
  };
}

/**
 * Extract text content from a response.
 */
export function extractTextContent(response: ChatResponse): string {
  return response.content
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Extract tool use blocks from a response.
 */
export function extractToolUses(response: ChatResponse): ToolUseBlock[] {
  return response.content.filter(
    (block): block is ToolUseBlock => block.type === 'tool_use'
  );
}
