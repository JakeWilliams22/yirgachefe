/**
 * Type definitions for the agent framework.
 */

import type { Message, ToolDefinition, ChatResponse } from '../services/anthropic';

/**
 * Result of executing a tool.
 */
export interface ToolResult {
  success: boolean;
  output: string;
  data?: unknown;
}

/**
 * A tool that an agent can use.
 */
export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (input: unknown) => Promise<ToolResult>;
}

/**
 * Convert our Tool interface to Anthropic's ToolDefinition.
 */
export function toolToDefinition(tool: Tool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

/**
 * Configuration for an agent.
 */
export interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  tools: Tool[];
  maxIterations?: number;
  maxTokens?: number;
}

/**
 * Current state of an agent execution.
 */
export type AgentStatus = 'idle' | 'running' | 'complete' | 'error';

/**
 * An event emitted during agent execution.
 */
export type AgentEvent =
  | { type: 'status_change'; status: AgentStatus; message?: string; iteration?: number }
  | { type: 'thinking'; text: string; iteration?: number }
  | { type: 'tool_call'; toolName: string; input: unknown; iteration?: number }
  | { type: 'tool_result'; toolName: string; result: ToolResult; iteration?: number }
  | { type: 'message'; role: 'assistant' | 'user'; content: string; iteration?: number; messageIndex?: number }
  | { type: 'discovery'; discovery: Discovery; iteration?: number }
  | { type: 'error'; error: string; iteration?: number }
  | { type: 'complete'; result: AgentResult }
  | { type: 'rate_limit'; waiting: boolean; waitMs?: number; message?: string; usage?: RateLimitUsage; timestamp?: number }
  | { type: 'iteration_start'; iteration: number; messageCount: number }
  | { type: 'iteration_complete'; iteration: number; tokenUsage: { input: number; output: number } }
  | { type: 'conversation_update'; messages: Message[]; iteration: number };

/**
 * Rate limit usage info.
 */
export interface RateLimitUsage {
  currentUsage: number;
  limit: number;
  utilizationPercent: number;
}

/**
 * A discovery made during exploration.
 */
export interface Discovery {
  id: string;
  type: 'file' | 'directory' | 'data_type' | 'pattern' | 'relationship';
  path?: string;
  description: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Final result of an agent execution.
 */
export interface AgentResult {
  success: boolean;
  summary: string;
  discoveries: Discovery[];
  conversationHistory: Message[];
  tokenUsage: {
    input: number;
    output: number;
  };
}

/**
 * Listener for agent events.
 */
export type AgentEventListener = (event: AgentEvent) => void;

/**
 * State maintained during agent execution.
 */
export interface AgentExecutionState {
  status: AgentStatus;
  messages: Message[];
  discoveries: Discovery[];
  tokenUsage: {
    input: number;
    output: number;
  };
  currentResponse?: ChatResponse;
  error?: string;
}
