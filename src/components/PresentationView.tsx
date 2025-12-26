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
  /** Final HTML for download/viewing (only in results phase) */
  html?: string | null;
}

export function PresentationView({
  isGenerating = false,
  screenshot = null,
  onContainerReady,
  html = null,
}: PresentationViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const hasCalledReadyRef = useRef(false);

  useEffect(() => {
    if (containerRef.current && onContainerReady && !hasCalledReadyRef.current) {
      hasCalledReadyRef.current = true;
      onContainerReady(containerRef.current);
    }
  }, [onContainerReady]);

  const handleDownload = () => {
    if (!html) return;

    // Track download event
    window.umami?.track('presentation-downloaded');

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `year-in-review-${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenInNewTab = () => {
    if (!html) return;

    // Track share event
    window.umami?.track('presentation-shared');

    const newWindow = window.open();
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
    }
  };

  const handleShare = () => {
    // Track share button click
    window.umami?.track('share-button-clicked');
    setShowShareModal(true);
  };

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
        {!isGenerating && (
          <div className="presentation-controls">
            {screenshot && (
              <button
                className={`screenshot-toggle ${showScreenshot ? 'active' : ''}`}
                onClick={() => setShowScreenshot(!showScreenshot)}
              >
                {showScreenshot ? 'Show Live' : 'Show Screenshot'}
              </button>
            )}
            {html && (
              <>
                <button
                  className="action-button"
                  onClick={handleOpenInNewTab}
                  title="Open in new tab"
                >
                  🗗 Open in New Tab
                </button>
                <button
                  className="action-button"
                  onClick={handleShare}
                  title="Share your presentation"
                >
                  🔗 Share
                </button>
                <button
                  className="action-button"
                  onClick={handleDownload}
                  title="Download HTML file"
                >
                  ⬇️ Download
                </button>
              </>
            )}
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

        {/* Watermark overlay */}
        {!showScreenshot && (
          <a
            href="https://yirgachefe.lol"
            target="_blank"
            rel="noopener noreferrer"
            className="presentation-watermark"
          >
            yirgachefe.lol
          </a>
        )}

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

      {/* Share Modal */}
      {showShareModal && (
        <div className="share-modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="share-modal" onClick={(e) => e.stopPropagation()}>
            <div className="share-modal-header">
              <h3>Share Your Presentation</h3>
              <button
                className="share-modal-close"
                onClick={() => setShowShareModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="share-modal-content">
              <p className="share-modal-message">
                This is an indie app with no backend OK I didn't have time to implement it. But I do know how many people click this button so maybe it'll come soon
              </p>
              <div className="share-modal-instructions">
                <h4>How to share:</h4>
                <ol>
                  <li>Click <strong>"Download"</strong> to get the HTML file</li>
                  <li>Host it on your favorite static hosting service: GitHub Pages, Cloudflare Pages, Vercel, or your home server</li>
                  <li>Share!</li>
                </ol>
              </div>
            </div>
            <div className="share-modal-footer">
              <button
                className="share-modal-button"
                onClick={() => setShowShareModal(false)}
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
