/**
 * PresentationView component - Displays the animated year-in-review presentation
 */

import { useEffect, useRef, useState } from 'react';
import './PresentationView.css';

interface PresentationViewProps {
  /** Whether the agent is currently working */
  isGenerating?: boolean;
  /** Latest screenshot from the agent's iteration */
  screenshot?: string | null;
  /** Callback to get the iframe container ref */
  onContainerReady?: (container: HTMLDivElement) => void;
}

export function PresentationView({
  isGenerating = false,
  screenshot = null,
  onContainerReady,
}: PresentationViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const hasCalledReadyRef = useRef(false);

  useEffect(() => {
    if (containerRef.current && onContainerReady && !hasCalledReadyRef.current) {
      hasCalledReadyRef.current = true;
      onContainerReady(containerRef.current);
    }
  }, [onContainerReady]);

  return (
    <div className="presentation-view">
      <div className="presentation-header">
        <h3>Your Year in Review</h3>
        {isGenerating && (
          <div className="presentation-status">
            <span className="status-spinner"></span>
            <span>Agent is designing your presentation...</span>
          </div>
        )}
        {!isGenerating && screenshot && (
          <div className="presentation-controls">
            <button
              className={`screenshot-toggle ${showScreenshot ? 'active' : ''}`}
              onClick={() => setShowScreenshot(!showScreenshot)}
            >
              {showScreenshot ? 'Show Live' : 'Show Screenshot'}
            </button>
          </div>
        )}
      </div>

      <div className="presentation-container">
        {/* Live iframe container */}
        <div
          ref={containerRef}
          className={`iframe-container ${showScreenshot ? 'hidden' : ''}`}
        >
          {/* Iframe will be injected here by PresentationExecutor */}
        </div>

        {/* Screenshot view for agent iteration */}
        {screenshot && showScreenshot && (
          <div className="screenshot-container">
            <img src={screenshot} alt="Presentation screenshot" />
          </div>
        )}

        {/* Loading state */}
        {!screenshot && isGenerating && (
          <div className="presentation-loading">
            <div className="loading-spinner"></div>
            <p>Creating your personalized year-in-review...</p>
          </div>
        )}
      </div>
    </div>
  );
}
