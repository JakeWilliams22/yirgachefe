/**
 * Component for browsing and managing saved checkpoints.
 */

import { useState } from 'react';
import type { IterationCheckpoint } from '../services/persistence';
import {
  listAvailableCheckpoints,
  getCheckpointAtIteration,
  deleteCheckpoint,
  updateCheckpointLabel,
} from '../services/persistence';
import { ConversationHistoryView } from './ConversationHistoryView';
import './CheckpointBrowser.css';

export interface CheckpointBrowserProps {
  sessionId: string;
  onResumeFromCheckpoint: (checkpoint: IterationCheckpoint) => void;
  onClose: () => void;
}

export function CheckpointBrowser({
  sessionId,
  onResumeFromCheckpoint,
  onClose,
}: CheckpointBrowserProps) {
  const [selectedIteration, setSelectedIteration] = useState<number | null>(null);
  const [checkpoints, setCheckpoints] = useState(() => listAvailableCheckpoints(sessionId));

  const refreshCheckpoints = () => {
    setCheckpoints(listAvailableCheckpoints(sessionId));
  };

  const handleDelete = (iteration: number) => {
    if (confirm(`Delete checkpoint for iteration ${iteration}?`)) {
      deleteCheckpoint(sessionId, iteration);
      refreshCheckpoints();
      if (selectedIteration === iteration) {
        setSelectedIteration(null);
      }
    }
  };

  const handleResume = (iteration: number) => {
    const checkpoint = getCheckpointAtIteration(sessionId, iteration);
    if (checkpoint) {
      onResumeFromCheckpoint(checkpoint);
      onClose();
    }
  };

  const selectedCheckpoint = selectedIteration
    ? getCheckpointAtIteration(sessionId, selectedIteration)
    : null;

  if (checkpoints.length === 0) {
    return (
      <div className="checkpoint-browser-overlay" onClick={onClose}>
        <div className="checkpoint-browser-modal" onClick={(e) => e.stopPropagation()}>
          <div className="browser-header">
            <h2>Saved Checkpoints</h2>
            <button className="close-button" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="browser-body empty">
            <p>No checkpoints found for this session.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="checkpoint-browser-overlay" onClick={onClose}>
      <div className="checkpoint-browser-modal" onClick={(e) => e.stopPropagation()}>
        <div className="browser-header">
          <h2>Saved Checkpoints</h2>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="browser-body">
          <div className="checkpoint-list">
            <h3>Available Checkpoints ({checkpoints.length})</h3>
            <div className="checkpoint-timeline">
              {checkpoints.map((cp) => (
                <CheckpointCard
                  key={cp.iteration}
                  checkpoint={cp}
                  selected={selectedIteration === cp.iteration}
                  onSelect={() => setSelectedIteration(cp.iteration)}
                  onResume={() => handleResume(cp.iteration)}
                  onDelete={() => handleDelete(cp.iteration)}
                  onLabelUpdate={(label) => {
                    updateCheckpointLabel(sessionId, cp.iteration, label);
                    refreshCheckpoints();
                  }}
                />
              ))}
            </div>
          </div>

          {selectedCheckpoint && (
            <div className="checkpoint-detail">
              <h3>Checkpoint Details</h3>
              <ConversationHistoryView
                messages={selectedCheckpoint.messages}
                tokenUsage={selectedCheckpoint.tokenUsage}
                editable={false}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface CheckpointCardProps {
  checkpoint: {
    iteration: number;
    label: string;
    timestamp: string;
    messageCount: number;
    tokenUsage: number;
  };
  selected: boolean;
  onSelect: () => void;
  onResume: () => void;
  onDelete: () => void;
  onLabelUpdate: (label: string) => void;
}

function CheckpointCard({
  checkpoint,
  selected,
  onSelect,
  onResume,
  onDelete,
  onLabelUpdate,
}: CheckpointCardProps) {
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(checkpoint.label);

  const handleLabelSave = () => {
    onLabelUpdate(labelValue);
    setIsEditingLabel(false);
  };

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleString();
  };

  return (
    <div
      className={`checkpoint-card ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="checkpoint-header">
        <span className="iteration-badge">Iteration {checkpoint.iteration}</span>
        <span className="timestamp">{formatTimestamp(checkpoint.timestamp)}</span>
      </div>

      <div className="checkpoint-label">
        {isEditingLabel ? (
          <input
            type="text"
            value={labelValue}
            onChange={(e) => setLabelValue(e.target.value)}
            onBlur={handleLabelSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLabelSave();
              if (e.key === 'Escape') {
                setLabelValue(checkpoint.label);
                setIsEditingLabel(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            className="label-input"
          />
        ) : (
          <span
            className="label-text"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditingLabel(true);
            }}
            title="Click to edit label"
          >
            {checkpoint.label}
          </span>
        )}
      </div>

      <div className="checkpoint-stats">
        <span>📝 {checkpoint.messageCount} messages</span>
        <span>🔢 {checkpoint.tokenUsage.toLocaleString()} tokens</span>
      </div>

      <div className="checkpoint-actions">
        <button
          className="action-btn resume-btn"
          onClick={(e) => {
            e.stopPropagation();
            onResume();
          }}
          title="Resume from this checkpoint"
        >
          ▶️ Resume
        </button>
        <button
          className="action-btn delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete this checkpoint"
        >
          🗑️ Delete
        </button>
      </div>
    </div>
  );
}
