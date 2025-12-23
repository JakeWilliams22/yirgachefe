/**
 * Component to display full conversation history with message details.
 * Shows ContentBlocks, iteration markers, and supports message editing.
 */

import { useState } from 'react';
import type { Message, ContentBlock } from '../services/anthropic';
import { MessageInspector } from './MessageInspector';
import './ConversationHistoryView.css';

export interface ConversationHistoryViewProps {
  messages: Message[];
  tokenUsage?: { input: number; output: number };
  currentIteration?: number;
  editable?: boolean;
  onMessageEdit?: (index: number, newMessage: Message) => void;
  onResumeFrom?: (index: number) => void;
}

export function ConversationHistoryView({
  messages,
  tokenUsage,
  editable = false,
  onMessageEdit,
  onResumeFrom,
}: ConversationHistoryViewProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleEdit = (index: number) => {
    setEditingIndex(index);
  };

  const handleSaveEdit = (newMessage: Message) => {
    if (editingIndex !== null && onMessageEdit) {
      onMessageEdit(editingIndex, newMessage);
      setEditingIndex(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
  };

  if (messages.length === 0) {
    return (
      <div className="conversation-history empty">
        <p className="empty-state">No messages yet...</p>
      </div>
    );
  }

  return (
    <>
      <div className="conversation-history">
        {messages.map((message, index) => (
          <MessageCard
            key={index}
            message={message}
            index={index}
            iteration={undefined} // Will be populated once we have iteration tracking
            editable={editable}
            onEdit={handleEdit}
            onResumeFrom={onResumeFrom}
          />
        ))}
        {tokenUsage && (
          <div className="conversation-footer">
            <span className="token-summary">
              Total Tokens: {tokenUsage.input.toLocaleString()} in / {tokenUsage.output.toLocaleString()} out
            </span>
          </div>
        )}
      </div>

      {editingIndex !== null && (
        <MessageInspector
          message={messages[editingIndex]}
          messageIndex={editingIndex}
          allMessages={messages}
          onSave={handleSaveEdit}
          onCancel={handleCancelEdit}
        />
      )}
    </>
  );
}

interface MessageCardProps {
  message: Message;
  index: number;
  iteration?: number;
  editable: boolean;
  onEdit?: (index: number) => void;
  onResumeFrom?: (index: number) => void;
}

function MessageCard({
  message,
  index,
  iteration,
  editable,
  onEdit,
  onResumeFrom,
}: MessageCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  return (
    <div className={`message-card message-${message.role}`}>
      <div className="message-header">
        <div className="message-meta">
          <span className="message-role">{message.role}</span>
          <span className="message-index">#{index + 1}</span>
          {iteration !== undefined && (
            <span className="message-iteration">Iteration {iteration}</span>
          )}
        </div>
        <div className="message-actions">
          <button
            className="action-button"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▼' : '▶'}
          </button>
          <button
            className="action-button"
            onClick={() => setShowRawJson(!showRawJson)}
            title="View raw JSON"
          >
            {showRawJson ? '📋 Hide JSON' : '📋 JSON'}
          </button>
          {editable && onEdit && (
            <button
              className="action-button edit-button"
              onClick={() => onEdit(index)}
              title="Edit message"
            >
              ✏️ Edit
            </button>
          )}
        </div>
      </div>

      {showRawJson && (
        <div className="raw-json-view">
          <pre>{JSON.stringify(message, null, 2)}</pre>
        </div>
      )}

      {expanded && !showRawJson && (
        <div className="message-content">
          {renderContent(message.content)}
        </div>
      )}

      {editable && onResumeFrom && (
        <div className="message-footer">
          <button
            className="resume-from-button"
            onClick={() => onResumeFrom(index)}
            title="Resume execution from this point"
          >
            ⏭ Resume from here
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Render message content (string or ContentBlock array)
 */
function renderContent(content: string | ContentBlock[]) {
  if (typeof content === 'string') {
    return (
      <div className="content-text">
        <p>{content}</p>
      </div>
    );
  }

  return (
    <div className="content-blocks">
      {content.map((block, i) => (
        <ContentBlockView key={i} block={block} />
      ))}
    </div>
  );
}

interface ContentBlockViewProps {
  block: ContentBlock;
}

function ContentBlockView({ block }: ContentBlockViewProps) {
  const [expanded, setExpanded] = useState(true);

  switch (block.type) {
    case 'text':
      return (
        <div className="content-block content-block-text">
          <div className="block-content">
            <p>{block.text}</p>
          </div>
        </div>
      );

    case 'tool_use':
      return (
        <div className="content-block content-block-tool-use">
          <div
            className="block-header clickable"
            onClick={() => setExpanded(!expanded)}
          >
            <span className="block-icon">🔧</span>
            <span className="block-title">Tool Use: {block.name}</span>
            <span className="toggle-icon">{expanded ? '▼' : '▶'}</span>
          </div>
          {expanded && (
            <div className="block-content">
              <div className="block-meta">
                <span className="meta-label">ID:</span>
                <span className="meta-value">{block.id}</span>
              </div>
              <div className="block-json">
                <div className="json-label">Input:</div>
                <pre>{JSON.stringify(block.input, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
      );

    case 'tool_result':
      const isError = block.is_error;
      return (
        <div
          className={`content-block content-block-tool-result ${isError ? 'error' : 'success'}`}
        >
          <div
            className="block-header clickable"
            onClick={() => setExpanded(!expanded)}
          >
            <span className="block-icon">{isError ? '❌' : '✅'}</span>
            <span className="block-title">
              Tool Result {isError ? '(Error)' : '(Success)'}
            </span>
            <span className="toggle-icon">{expanded ? '▼' : '▶'}</span>
          </div>
          {expanded && (
            <div className="block-content">
              <div className="block-meta">
                <span className="meta-label">Tool Use ID:</span>
                <span className="meta-value">{block.tool_use_id}</span>
              </div>
              <div className="block-output">
                {typeof block.content === 'string' ? (
                  <pre>{block.content}</pre>
                ) : (
                  renderContent(block.content!)
                )}
              </div>
            </div>
          )}
        </div>
      );

    case 'image':
      return (
        <div className="content-block content-block-image">
          <div className="block-header">
            <span className="block-icon">🖼️</span>
            <span className="block-title">Image</span>
          </div>
          <div className="block-content">
            {block.source && block.source.type === 'base64' && (
              <img
                src={`data:${block.source.media_type};base64,${block.source.data}`}
                alt="Content"
                className="block-image"
              />
            )}
          </div>
        </div>
      );

    default:
      return (
        <div className="content-block content-block-unknown">
          <div className="block-header">
            <span className="block-icon">❓</span>
            <span className="block-title">Unknown Block Type</span>
          </div>
          <div className="block-content">
            <pre>{JSON.stringify(block, null, 2)}</pre>
          </div>
        </div>
      );
  }
}
