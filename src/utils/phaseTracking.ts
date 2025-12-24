/**
 * Utilities for tracking and separating agent phases
 */

import type { Message } from '../services/anthropic';
import type { AgentEvent } from '../agents/types';

export interface PhaseData {
  name: 'exploration' | 'code-writing' | 'presentation';
  displayName: string;
  messages: Message[];
  events: AgentEvent[];
  startIndex: number;
  endIndex: number;
}

/**
 * Split messages into phases based on phase transition markers
 */
export function splitMessagesByPhase(messages: Message[]): PhaseData[] {
  const phases: PhaseData[] = [];

  // Find phase transition markers
  const transitionIndices: Array<{ index: number; phase: PhaseData['name']; displayName: string }> = [];

  messages.forEach((msg, index) => {
    if (msg.role === 'user' && typeof msg.content === 'string') {
      if (msg.content.includes('CODE WRITING AGENT')) {
        transitionIndices.push({ index, phase: 'code-writing', displayName: 'Code Writing Agent' });
      } else if (msg.content.includes('PRESENTATION AGENT')) {
        transitionIndices.push({ index, phase: 'presentation', displayName: 'Presentation Agent' });
      }
    }
  });

  // Create phases
  // First phase is exploration (from start to first transition)
  const explorationEnd = transitionIndices.length > 0 ? transitionIndices[0].index : messages.length;
  if (explorationEnd > 0) {
    phases.push({
      name: 'exploration',
      displayName: 'Exploration Agent',
      messages: messages.slice(0, explorationEnd),
      events: [], // Will be filled later
      startIndex: 0,
      endIndex: explorationEnd,
    });
  }

  // Add subsequent phases
  for (let i = 0; i < transitionIndices.length; i++) {
    const start = transitionIndices[i].index;
    const end = i < transitionIndices.length - 1 ? transitionIndices[i + 1].index : messages.length;

    phases.push({
      name: transitionIndices[i].phase,
      displayName: transitionIndices[i].displayName,
      messages: messages.slice(start, end),
      events: [], // Will be filled later
      startIndex: start,
      endIndex: end,
    });
  }

  return phases;
}

/**
 * Assign events to phases based on timing
 * Since events don't have explicit phase markers, we use heuristics:
 * - Events before first 'complete' event -> exploration
 * - Events after first 'complete' and before second -> code writing
 * - Events after second 'complete' -> presentation
 */
export function assignEventsToPhases(events: AgentEvent[], phases: PhaseData[]): void {
  if (phases.length === 0) return;

  let currentPhaseIndex = 0;

  for (const event of events) {
    // Check if this is a completion event that signals phase transition
    if (event.type === 'complete' && currentPhaseIndex < phases.length - 1) {
      // Add this completion event to current phase
      phases[currentPhaseIndex].events.push(event);
      // Move to next phase
      currentPhaseIndex++;
    } else {
      // Add event to current phase
      if (currentPhaseIndex < phases.length) {
        phases[currentPhaseIndex].events.push(event);
      }
    }
  }
}

/**
 * Get phase-separated data from messages and events
 */
export function getPhaseData(
  messages: Message[],
  events: AgentEvent[]
): PhaseData[] {
  const phases = splitMessagesByPhase(messages);
  assignEventsToPhases(events, phases);
  return phases;
}
