/**
 * Component showing real-time agent progress during exploration and code writing.
 */

import { useState, useEffect, useRef } from 'react';
import type { AgentEvent, AgentResult, Discovery, RateLimitUsage } from '../agents/types';
import type { Insight } from '../types/insights';
import { InsightsView } from './InsightsView';

interface AgentProgressProps {
  events: AgentEvent[];
  result: AgentResult | null;
  onStop?: () => void;
  insights?: Insight[];
}

/**
 * Countdown timer component for rate limit waiting
 */
function RateLimitCountdown({ waitMs, startTime }: { waitMs: number; startTime: number }) {
  const [secondsRemaining, setSecondsRemaining] = useState(
    Math.ceil((waitMs - (Date.now() - startTime)) / 1000)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.ceil((waitMs - (Date.now() - startTime)) / 1000);
      setSecondsRemaining(Math.max(0, remaining));

      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 100); // Update every 100ms for smoother countdown

    return () => clearInterval(interval);
  }, [waitMs, startTime]);

  return <>{secondsRemaining}s</>;
}

export function AgentProgress({ events, result, onStop, insights = [] }: AgentProgressProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['activity', 'discoveries'])
  );
  const activityRef = useRef<HTMLDivElement>(null);

  // Auto-scroll activity log
  useEffect(() => {
    if (activityRef.current) {
      activityRef.current.scrollTop = activityRef.current.scrollHeight;
    }
  }, [events]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const currentStatus = getLatestStatus(events);
  const discoveries = getDiscoveries(events);
  const activityLog = getActivityLog(events);
  const thinkingText = getLatestThinking(events);
  const rateLimitInfo = getRateLimitInfo(events);

  return (
    <div className="agent-progress">
      <div className="status-bar">
        <span className={`status-indicator ${rateLimitInfo.waiting ? 'waiting' : currentStatus}`} />
        <span className="status-text">
          {rateLimitInfo.waiting && rateLimitInfo.waitMs && rateLimitInfo.startTime
            ? <>Rate limit - waiting <RateLimitCountdown waitMs={rateLimitInfo.waitMs} startTime={rateLimitInfo.startTime} />...</>
            : rateLimitInfo.waiting
              ? `Rate limit - waiting...`
              : currentStatus === 'running'
                ? 'Exploring...'
                : currentStatus === 'complete'
                  ? 'Exploration Complete'
                  : currentStatus === 'error'
                    ? 'Error'
                    : 'Starting...'}
        </span>
        {rateLimitInfo.usage && (
          <span className="rate-limit-badge">
            <span
              className="rate-limit-bar"
              style={{ width: `${Math.min(rateLimitInfo.usage.utilizationPercent, 100)}%` }}
            />
            <span className="rate-limit-text">
              {rateLimitInfo.usage.utilizationPercent}% tokens
            </span>
          </span>
        )}
        {currentStatus === 'running' && onStop && (
          <button className="stop-button" onClick={onStop}>
            Stop
          </button>
        )}
      </div>

      {rateLimitInfo.waiting && rateLimitInfo.message && (
        <div className="rate-limit-box">
          <span className="rate-limit-icon">⏳</span>
          <span>{rateLimitInfo.message}</span>
        </div>
      )}

      {thinkingText && currentStatus === 'running' && !rateLimitInfo.waiting && (
        <div className="thinking-box">
          <span className="thinking-label">Agent is thinking:</span>
          <p>{truncate(thinkingText, 200)}</p>
        </div>
      )}

      <div className="progress-sections">
        {/* Activity Log */}
        <section className="progress-section">
          <h3
            className="section-header"
            onClick={() => toggleSection('activity')}
          >
            <span className="toggle">
              {expandedSections.has('activity') ? '▼' : '▶'}
            </span>
            Activity Log ({activityLog.length})
          </h3>
          {expandedSections.has('activity') && (
            <div className="activity-log" ref={activityRef}>
              {activityLog.map((item, index) => (
                <div key={index} className={`activity-item ${item.type}`}>
                  <span className="activity-icon">{item.icon}</span>
                  <span className="activity-text">{item.text}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Discoveries */}
        <section className="progress-section">
          <h3
            className="section-header"
            onClick={() => toggleSection('discoveries')}
          >
            <span className="toggle">
              {expandedSections.has('discoveries') ? '▼' : '▶'}
            </span>
            Discoveries ({discoveries.length})
          </h3>
          {expandedSections.has('discoveries') && (
            <div className="discoveries-list">
              {discoveries.length === 0 ? (
                <p className="empty-state">No discoveries yet...</p>
              ) : (
                discoveries.map((d) => (
                  <div key={d.id} className={`discovery-item ${d.type}`}>
                    <span className="discovery-icon">{getDiscoveryIcon(d)}</span>
                    <div className="discovery-content">
                      <span className="discovery-description">{d.description}</span>
                      {d.path && (
                        <span className="discovery-path">{d.path}</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      </div>

      {/* Final Result */}
      {result && (
        <div className={`result-box ${result.success ? 'success' : 'error'}`}>
          <h3>
            {result.success
              ? (insights.length > 0 ? 'Analysis Complete' : 'Exploration Complete')
              : 'Analysis Failed'}
          </h3>
          <div className="result-summary">
            <p>{result.summary}</p>
          </div>
          <div className="result-stats">
            <span>Discoveries: {result.discoveries.length}</span>
            <span>
              Tokens: {result.tokenUsage.input.toLocaleString()} in /{' '}
              {result.tokenUsage.output.toLocaleString()} out
            </span>
          </div>
        </div>
      )}

      {/* Generated Insights */}
      {insights.length > 0 && <InsightsView insights={insights} />}
    </div>
  );
}

// Helper functions

function getLatestStatus(events: AgentEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'status_change') {
      return (events[i] as { type: 'status_change'; status: string }).status;
    }
  }
  return 'idle';
}

function getDiscoveries(events: AgentEvent[]): Discovery[] {
  const discoveries: Discovery[] = [];
  for (const event of events) {
    if (event.type === 'discovery') {
      discoveries.push(event.discovery);
    }
  }
  return discoveries;
}

interface RateLimitInfo {
  waiting: boolean;
  waitMs?: number;
  message?: string;
  usage?: RateLimitUsage;
  startTime?: number;
}

function getRateLimitInfo(events: AgentEvent[]): RateLimitInfo {
  let waiting = false;
  let waitMs: number | undefined;
  let message: string | undefined;
  let usage: RateLimitUsage | undefined;
  let startTime: number | undefined;

  // Get the latest rate limit info
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'rate_limit') {
      if (event.waiting !== undefined) {
        waiting = event.waiting;
        waitMs = event.waitMs;
        message = event.message;
        startTime = event.timestamp;
      }
      if (event.usage) {
        usage = event.usage;
      }
      // Only need the most recent rate limit state
      if (waiting || usage) break;
    }
  }

  return { waiting, waitMs, message, usage, startTime };
}

interface ActivityItem {
  type: string;
  icon: string;
  text: string;
}

function getActivityLog(events: AgentEvent[]): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'tool_call':
        items.push({
          type: 'tool-call',
          icon: '🔧',
          text: `Calling ${event.toolName}`,
        });
        break;
      case 'tool_result':
        items.push({
          type: event.result.success ? 'tool-success' : 'tool-error',
          icon: event.result.success ? '✅' : '❌',
          text: truncate(event.result.output, 100),
        });
        break;
      case 'rate_limit':
        if (event.waiting) {
          items.push({
            type: 'rate-limit',
            icon: '⏳',
            text: event.message || 'Waiting for rate limit...',
          });
        }
        break;
      case 'error':
        items.push({
          type: 'error',
          icon: '⚠️',
          text: event.error,
        });
        break;
    }
  }

  return items;
}

function getLatestThinking(events: AgentEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'thinking') {
      return (events[i] as { type: 'thinking'; text: string }).text;
    }
  }
  return null;
}

function getDiscoveryIcon(discovery: Discovery): string {
  switch (discovery.type) {
    case 'directory':
      return '📁';
    case 'file':
      return '📄';
    case 'data_type':
      return '📊';
    case 'pattern':
      return '🔍';
    case 'relationship':
      return '🔗';
    default:
      return '📌';
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
