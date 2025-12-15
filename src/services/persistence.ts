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
