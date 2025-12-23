/**
 * State persistence service for browser storage.
 * Saves exploration progress to survive refreshes and failures.
 */

import type { Message } from './anthropic';
import type { Discovery } from '../agents/types';

const STORAGE_PREFIX = 'yir_'; // Year in Review prefix
const API_KEY_KEY = `${STORAGE_PREFIX}api_key`;
const SESSION_KEY = `${STORAGE_PREFIX}session`;
const CHECKPOINT_KEY = `${STORAGE_PREFIX}checkpoint`;

/**
 * Saved session state.
 */
export interface SessionState {
  directoryName: string;
  startedAt: string;
  lastUpdatedAt: string;
}

/**
 * Checkpoint of agent execution state.
 */
export interface AgentCheckpoint {
  sessionId: string;
  messages: Message[];
  discoveries: Discovery[];
  tokenUsage: {
    input: number;
    output: number;
  };
  iteration: number;
  status: 'running' | 'paused' | 'error';
  error?: string;
  lastUpdatedAt: string;
}

/**
 * Single iteration checkpoint.
 */
export interface IterationCheckpoint {
  iteration: number;
  timestamp: string;
  messages: Message[];
  discoveries: Discovery[];
  tokenUsage: { input: number; output: number };
  label?: string;
}

/**
 * Collection of checkpoints for a session.
 */
export interface SessionCheckpoints {
  sessionId: string;
  agentType: 'exploration' | 'code-writing' | 'presentation';
  checkpoints: IterationCheckpoint[];
  currentIteration: number;
  lastUpdated: string;
}

// --- API Key (Session Storage - cleared on browser close) ---

export function saveApiKey(apiKey: string): void {
  try {
    // Use sessionStorage so key is cleared when browser closes
    sessionStorage.setItem(API_KEY_KEY, apiKey);
  } catch (e) {
    console.warn('Failed to save API key:', e);
  }
}

export function loadApiKey(): string | null {
  try {
    return sessionStorage.getItem(API_KEY_KEY);
  } catch (e) {
    console.warn('Failed to load API key:', e);
    return null;
  }
}

export function clearApiKey(): void {
  try {
    sessionStorage.removeItem(API_KEY_KEY);
  } catch (e) {
    console.warn('Failed to clear API key:', e);
  }
}

// --- Session State (Local Storage - persists across browser sessions) ---

export function saveSession(state: SessionState): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save session:', e);
  }
}

export function loadSession(): SessionState | null {
  try {
    const data = localStorage.getItem(SESSION_KEY);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.warn('Failed to load session:', e);
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(CHECKPOINT_KEY);
  } catch (e) {
    console.warn('Failed to clear session:', e);
  }
}

// --- Agent Checkpoint (Local Storage) ---

export function saveCheckpoint(checkpoint: AgentCheckpoint): void {
  try {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint));
  } catch (e) {
    // If storage is full, try to save a minimal checkpoint
    console.warn('Failed to save full checkpoint, trying minimal:', e);
    try {
      const minimal: AgentCheckpoint = {
        ...checkpoint,
        messages: checkpoint.messages.slice(-10), // Keep only last 10 messages
      };
      localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(minimal));
    } catch (e2) {
      console.error('Failed to save even minimal checkpoint:', e2);
    }
  }
}

export function loadCheckpoint(): AgentCheckpoint | null {
  try {
    const data = localStorage.getItem(CHECKPOINT_KEY);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.warn('Failed to load checkpoint:', e);
    return null;
  }
}

export function clearCheckpoint(): void {
  try {
    localStorage.removeItem(CHECKPOINT_KEY);
  } catch (e) {
    console.warn('Failed to clear checkpoint:', e);
  }
}

// --- Utility ---

/**
 * Check if there's a resumable session.
 */
export function hasResumableSession(): boolean {
  const session = loadSession();
  const checkpoint = loadCheckpoint();
  return !!(session && checkpoint && checkpoint.status !== 'running');
}

/**
 * Get summary of resumable session.
 */
export function getResumableSummary(): {
  directoryName: string;
  discoveries: number;
  lastUpdated: string;
  status: string;
} | null {
  const session = loadSession();
  const checkpoint = loadCheckpoint();

  if (!session || !checkpoint) return null;

  return {
    directoryName: session.directoryName,
    discoveries: checkpoint.discoveries.length,
    lastUpdated: checkpoint.lastUpdatedAt,
    status: checkpoint.status,
  };
}

/**
 * Clear all persisted state.
 */
export function clearAllState(): void {
  clearApiKey();
  clearSession();
  clearCheckpoint();
}

/**
 * Generate a unique session ID.
 */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// --- Code Writer Result (for quick presentation testing) ---

const CODE_WRITER_RESULT_KEY = `${STORAGE_PREFIX}code_writer_result`;

/**
 * Save code writer result for testing presentations without re-running analysis
 */
export function saveCodeWriterResult(result: any): void {
  try {
    localStorage.setItem(CODE_WRITER_RESULT_KEY, JSON.stringify(result));
  } catch (error) {
    console.error('Failed to save code writer result:', error);
  }
}

/**
 * Load saved code writer result
 */
export function loadCodeWriterResult(): any | null {
  try {
    const data = localStorage.getItem(CODE_WRITER_RESULT_KEY);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Failed to load code writer result:', error);
    return null;
  }
}

/**
 * Clear saved code writer result
 */
export function clearCodeWriterResult(): void {
  try {
    localStorage.removeItem(CODE_WRITER_RESULT_KEY);
  } catch (e) {
    console.warn('Failed to clear code writer result:', e);
  }
}

// --- Multi-Iteration Checkpoints (New System) ---

const MAX_CHECKPOINTS = 50; // Keep last 50 iterations

function getCheckpointsKey(sessionId: string): string {
  return `${STORAGE_PREFIX}checkpoints_${sessionId}`;
}

/**
 * Save a checkpoint for a specific iteration.
 */
export function saveIterationCheckpoint(
  sessionId: string,
  checkpoint: IterationCheckpoint,
  agentType: 'exploration' | 'code-writing' | 'presentation' = 'exploration'
): void {
  try {
    const key = getCheckpointsKey(sessionId);
    const existing = loadSessionCheckpoints(sessionId);

    const checkpoints: SessionCheckpoints = existing || {
      sessionId,
      agentType,
      checkpoints: [],
      currentIteration: 0,
      lastUpdated: new Date().toISOString(),
    };

    // Remove existing checkpoint for this iteration if any
    checkpoints.checkpoints = checkpoints.checkpoints.filter(
      (c) => c.iteration !== checkpoint.iteration
    );

    // Add new checkpoint
    checkpoints.checkpoints.push(checkpoint);

    // Sort by iteration
    checkpoints.checkpoints.sort((a, b) => a.iteration - b.iteration);

    // Keep only last MAX_CHECKPOINTS
    if (checkpoints.checkpoints.length > MAX_CHECKPOINTS) {
      checkpoints.checkpoints = checkpoints.checkpoints.slice(-MAX_CHECKPOINTS);
    }

    // Update metadata
    checkpoints.currentIteration = checkpoint.iteration;
    checkpoints.lastUpdated = new Date().toISOString();

    localStorage.setItem(key, JSON.stringify(checkpoints));
  } catch (e) {
    console.warn('Failed to save iteration checkpoint:', e);
  }
}

/**
 * Load all checkpoints for a session.
 */
export function loadSessionCheckpoints(sessionId: string): SessionCheckpoints | null {
  try {
    const key = getCheckpointsKey(sessionId);
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.warn('Failed to load session checkpoints:', e);
    return null;
  }
}

/**
 * Get checkpoint at a specific iteration.
 */
export function getCheckpointAtIteration(
  sessionId: string,
  iteration: number
): IterationCheckpoint | null {
  const session = loadSessionCheckpoints(sessionId);
  if (!session) return null;

  return session.checkpoints.find((c) => c.iteration === iteration) || null;
}

/**
 * List all available checkpoints with metadata.
 */
export function listAvailableCheckpoints(
  sessionId: string
): Array<{ iteration: number; label: string; timestamp: string; messageCount: number; tokenUsage: number }> {
  const session = loadSessionCheckpoints(sessionId);
  if (!session) return [];

  return session.checkpoints.map((c) => ({
    iteration: c.iteration,
    label: c.label || `Iteration ${c.iteration}`,
    timestamp: c.timestamp,
    messageCount: c.messages.length,
    tokenUsage: c.tokenUsage.input + c.tokenUsage.output,
  }));
}

/**
 * Delete a specific checkpoint.
 */
export function deleteCheckpoint(sessionId: string, iteration: number): void {
  try {
    const session = loadSessionCheckpoints(sessionId);
    if (!session) return;

    session.checkpoints = session.checkpoints.filter((c) => c.iteration !== iteration);
    session.lastUpdated = new Date().toISOString();

    const key = getCheckpointsKey(sessionId);
    localStorage.setItem(key, JSON.stringify(session));
  } catch (e) {
    console.warn('Failed to delete checkpoint:', e);
  }
}

/**
 * Update label for a checkpoint.
 */
export function updateCheckpointLabel(
  sessionId: string,
  iteration: number,
  label: string
): void {
  try {
    const session = loadSessionCheckpoints(sessionId);
    if (!session) return;

    const checkpoint = session.checkpoints.find((c) => c.iteration === iteration);
    if (checkpoint) {
      checkpoint.label = label;
      session.lastUpdated = new Date().toISOString();

      const key = getCheckpointsKey(sessionId);
      localStorage.setItem(key, JSON.stringify(session));
    }
  } catch (e) {
    console.warn('Failed to update checkpoint label:', e);
  }
}

/**
 * Clear all checkpoints for a session.
 */
export function clearSessionCheckpoints(sessionId: string): void {
  try {
    const key = getCheckpointsKey(sessionId);
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('Failed to clear session checkpoints:', e);
  }
}
