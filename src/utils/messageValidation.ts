/**
 * Utilities for validating message structure and conversation flow.
 */

import type { Message } from '../services/anthropic';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a single message structure.
 */
export function validateMessage(message: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!message || typeof message !== 'object') {
    errors.push('Message must be an object');
    return { valid: false, errors, warnings };
  }

  const msg = message as Record<string, unknown>;

  // Validate role
  if (!msg.role || (msg.role !== 'user' && msg.role !== 'assistant')) {
    errors.push('Message role must be "user" or "assistant"');
  }

  // Validate content
  if (!msg.content) {
    errors.push('Message must have content');
  } else if (typeof msg.content === 'string') {
    // String content is valid
  } else if (Array.isArray(msg.content)) {
    // Validate content blocks
    for (let i = 0; i < msg.content.length; i++) {
      const block = msg.content[i];
      const blockErrors = validateContentBlock(block, i);
      errors.push(...blockErrors);
    }
  } else {
    errors.push('Message content must be a string or array of ContentBlocks');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a ContentBlock structure.
 */
function validateContentBlock(block: unknown, index: number): string[] {
  const errors: string[] = [];

  if (!block || typeof block !== 'object') {
    errors.push(`ContentBlock at index ${index} must be an object`);
    return errors;
  }

  const b = block as Record<string, unknown>;

  if (!b.type) {
    errors.push(`ContentBlock at index ${index} must have a type`);
    return errors;
  }

  switch (b.type) {
    case 'text':
      if (typeof b.text !== 'string') {
        errors.push(`ContentBlock at index ${index}: text block must have text property`);
      }
      break;

    case 'tool_use':
      if (!b.id || typeof b.id !== 'string') {
        errors.push(`ContentBlock at index ${index}: tool_use must have id`);
      }
      if (!b.name || typeof b.name !== 'string') {
        errors.push(`ContentBlock at index ${index}: tool_use must have name`);
      }
      if (b.input === undefined) {
        errors.push(`ContentBlock at index ${index}: tool_use must have input`);
      }
      break;

    case 'tool_result':
      if (!b.tool_use_id || typeof b.tool_use_id !== 'string') {
        errors.push(`ContentBlock at index ${index}: tool_result must have tool_use_id`);
      }
      if (b.content === undefined) {
        errors.push(`ContentBlock at index ${index}: tool_result must have content`);
      }
      break;

    case 'image':
      if (!b.source || typeof b.source !== 'object') {
        errors.push(`ContentBlock at index ${index}: image must have source`);
      }
      break;

    default:
      // Unknown types are warnings, not errors (for forward compatibility)
      break;
  }

  return errors;
}

/**
 * Validate that a sequence of messages forms a valid conversation.
 */
export function validateMessageSequence(messages: Message[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(messages)) {
    errors.push('Messages must be an array');
    return { valid: false, errors, warnings };
  }

  // Track tool_use ids to ensure tool_results reference valid tool_uses
  const toolUseIds = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    // Validate individual message
    const messageValidation = validateMessage(message);
    errors.push(...messageValidation.errors.map((e) => `Message ${i}: ${e}`));
    warnings.push(...messageValidation.warnings.map((w) => `Message ${i}: ${w}`));

    // Extract tool_use ids from assistant messages
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'tool_use' && block.id) {
          toolUseIds.add(block.id);
        }
      }
    }

    // Validate tool_result references in user messages
    if (message.role === 'user' && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          if (!toolUseIds.has(block.tool_use_id)) {
            warnings.push(
              `Message ${i}: tool_result references unknown tool_use_id: ${block.tool_use_id}`
            );
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate editing a message at a specific index.
 * Checks if the edit would break the conversation flow.
 */
export function validateMessageEdit(
  messages: Message[],
  editIndex: number,
  newMessage: Message
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate the new message itself
  const messageValidation = validateMessage(newMessage);
  errors.push(...messageValidation.errors);
  warnings.push(...messageValidation.warnings);

  if (editIndex < 0 || editIndex >= messages.length) {
    errors.push('Edit index out of bounds');
    return { valid: false, errors, warnings };
  }

  // Create a copy of messages with the edit applied
  const editedMessages = [...messages];
  editedMessages[editIndex] = newMessage;

  // Validate the entire sequence
  const sequenceValidation = validateMessageSequence(editedMessages);
  errors.push(...sequenceValidation.errors);
  warnings.push(...sequenceValidation.warnings);

  // Check if editing a user message with tool_results
  if (newMessage.role === 'user' && Array.isArray(newMessage.content)) {
    for (const block of newMessage.content) {
      if (block.type === 'tool_result') {
        warnings.push(
          'Editing tool_result blocks may invalidate subsequent messages that depend on these results'
        );
        break;
      }
    }
  }

  // Check if editing an assistant message with tool_use
  if (newMessage.role === 'assistant' && Array.isArray(newMessage.content)) {
    for (const block of newMessage.content) {
      if (block.type === 'tool_use') {
        warnings.push(
          'Editing tool_use blocks may invalidate subsequent tool_result messages'
        );
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
