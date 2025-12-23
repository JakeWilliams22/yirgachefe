/**
 * Component for inspecting and editing individual messages.
 */

import { useState, useEffect } from 'react';
import type { Message } from '../services/anthropic';
import { validateMessage, validateMessageEdit, type ValidationResult } from '../utils/messageValidation';
import './MessageInspector.css';

export interface MessageInspectorProps {
  message: Message;
  messageIndex: number;
  allMessages: Message[];
  onSave: (newMessage: Message) => void;
  onCancel: () => void;
}

export function MessageInspector({
  message,
  messageIndex,
  allMessages,
  onSave,
  onCancel,
}: MessageInspectorProps) {
  const [jsonText, setJsonText] = useState(JSON.stringify(message, null, 2));
  const [validation, setValidation] = useState<ValidationResult>({ valid: true, errors: [], warnings: [] });
  const [parsedMessage, setParsedMessage] = useState<Message | null>(message);

  useEffect(() => {
    // Validate whenever JSON changes
    try {
      const parsed = JSON.parse(jsonText);
      const messageValidation = validateMessage(parsed);

      if (messageValidation.valid) {
        // Also check if it would break the conversation
        const editValidation = validateMessageEdit(allMessages, messageIndex, parsed as Message);
        setValidation(editValidation);
        setParsedMessage(parsed as Message);
      } else {
        setValidation(messageValidation);
        setParsedMessage(null);
      }
    } catch (e) {
      setValidation({
        valid: false,
        errors: [`Invalid JSON: ${(e as Error).message}`],
        warnings: [],
      });
      setParsedMessage(null);
    }
  }, [jsonText, allMessages, messageIndex]);

  const handleSave = () => {
    if (validation.valid && parsedMessage) {
      onSave(parsedMessage);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl + S to save
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (validation.valid) {
        handleSave();
      }
    }
    // Escape to cancel
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="message-inspector-overlay" onClick={onCancel}>
      <div className="message-inspector-modal" onClick={(e) => e.stopPropagation()}>
        <div className="inspector-header">
          <h2>Edit Message #{messageIndex + 1}</h2>
          <button className="close-button" onClick={onCancel}>
            ×
          </button>
        </div>

        <div className="inspector-body">
          <div className="editor-pane">
            <h3>JSON Editor</h3>
            <div className="editor-help">
              Press Cmd/Ctrl+S to save, Escape to cancel
            </div>
            <textarea
              className="json-editor"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              autoFocus
            />

            {(validation.errors.length > 0 || validation.warnings.length > 0) && (
              <div className="validation-messages">
                {validation.errors.map((error, i) => (
                  <div key={`error-${i}`} className="validation-error">
                    ❌ {error}
                  </div>
                ))}
                {validation.warnings.map((warning, i) => (
                  <div key={`warning-${i}`} className="validation-warning">
                    ⚠️ {warning}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="preview-pane">
            <h3>Preview</h3>
            {parsedMessage ? (
              <div className="preview-content">
                <div className="preview-field">
                  <span className="field-label">Role:</span>
                  <span className={`field-value role-${parsedMessage.role}`}>
                    {parsedMessage.role}
                  </span>
                </div>
                <div className="preview-field">
                  <span className="field-label">Content Type:</span>
                  <span className="field-value">
                    {typeof parsedMessage.content === 'string' ? 'String' : `Array (${parsedMessage.content.length} blocks)`}
                  </span>
                </div>
                {typeof parsedMessage.content === 'string' ? (
                  <div className="preview-text">
                    <div className="field-label">Text:</div>
                    <pre>{parsedMessage.content}</pre>
                  </div>
                ) : (
                  <div className="preview-blocks">
                    <div className="field-label">Content Blocks:</div>
                    {parsedMessage.content.map((block, i) => (
                      <div key={i} className="preview-block">
                        <span className="block-type">{block.type}</span>
                        {block.type === 'tool_use' && (
                          <span className="block-info">: {block.name}</span>
                        )}
                        {block.type === 'tool_result' && (
                          <span className="block-info">
                            {block.is_error ? ' (error)' : ' (success)'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="preview-error">
                Cannot preview - fix validation errors first
              </div>
            )}
          </div>
        </div>

        <div className="inspector-footer">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="save-button"
            onClick={handleSave}
            disabled={!validation.valid}
            title={validation.valid ? 'Save changes' : 'Fix validation errors first'}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
