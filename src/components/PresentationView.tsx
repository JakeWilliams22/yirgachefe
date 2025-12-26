/**
 * PresentationView component - Displays the animated year-in-review presentation
 */

import { useEffect, useRef, useState } from 'react';
import './PresentationView.css';
import {
  createDataUrl,
  createGithubGist,
  canUseWebShare,
  shareWithWebApi,
  copyToClipboard,
  type DataUrlResult
} from '../utils/shareUtils';
import { PresentationExecutor } from '../services/presentationExecution';

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

  // Share modal state
  const [shareModalState, setShareModalState] = useState<'closed' | 'loading' | 'options'>('closed');
  const [shareError, setShareError] = useState<string | null>(null);
  const [dataUrlResult, setDataUrlResult] = useState<DataUrlResult | null>(null);
  const [gistUrl, setGistUrl] = useState<string | null>(null);
  const [isCreatingGist, setIsCreatingGist] = useState(false);
  const [isCopyingUrl, setIsCopyingUrl] = useState<'dataurl' | 'gist' | null>(null);

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

  const handleShare = async () => {
    if (!html) return;

    // Track initial click
    window.umami?.track('share-button-clicked');

    // Reset state
    setShareError(null);
    setDataUrlResult(null);
    setGistUrl(null);

    // Try Web Share API first (mobile)
    if (canUseWebShare() && containerRef.current) {
      setShareModalState('loading');
      setShowShareModal(true);

      try {
        // Generate screenshot
        const executor = new PresentationExecutor(containerRef.current);
        const screenshotResult = await executor.screenshot();

        if (screenshotResult.success && screenshotResult.dataUrl) {
          // Convert data URL to Blob
          const response = await fetch(screenshotResult.dataUrl);
          const blob = await response.blob();

          // Attempt native share
          const shareResult = await shareWithWebApi(
            blob,
            'My Year in Review 2025',
            'Check out my personalized year in review!'
          );

          if (shareResult.success) {
            window.umami?.track('share-webapi-success');
            setShareModalState('closed');
            setShowShareModal(false);
            return;
          }

          if (shareResult.cancelled) {
            window.umami?.track('share-webapi-cancelled');
            setShareModalState('closed');
            setShowShareModal(false);
            return;
          }

          // Share failed, fall through to modal
          window.umami?.track('share-webapi-failed', { error: shareResult.error || 'unknown' });
        }
      } catch (error) {
        console.error('Web Share failed:', error);
        window.umami?.track('share-webapi-error');
      }
    }

    // Show modal with all options
    setShowShareModal(true);
    setShareModalState('options');

    // Pre-generate data URL
    const dataUrl = await createDataUrl(html);
    setDataUrlResult(dataUrl);
  };

  const handleCopyDataUrl = async () => {
    if (!dataUrlResult?.url) return;

    setIsCopyingUrl('dataurl');
    const success = await copyToClipboard(dataUrlResult.url);
    setIsCopyingUrl(null);

    if (success) {
      window.umami?.track('share-dataurl-copied', {
        urlLength: dataUrlResult.url.length
      });
    } else {
      window.umami?.track('share-dataurl-copy-failed');
      setShareError('Failed to copy link. Please try selecting and copying manually.');
    }
  };

  const handleCreateGist = async () => {
    if (!html) return;

    setIsCreatingGist(true);
    setShareError(null);
    window.umami?.track('share-gist-attempt');

    const fileName = `year-in-review-${new Date().getFullYear()}.html`;
    const result = await createGithubGist(html, fileName);

    setIsCreatingGist(false);

    if (result.success && result.url) {
      window.umami?.track('share-gist-success', {
        remaining: result.rateLimitRemaining ?? 0
      });
      setGistUrl(result.url);
    } else {
      if (result.errorType === 'rate_limit') {
        window.umami?.track('share-gist-rate-limited');
        const resetTime = result.rateLimitReset
          ? result.rateLimitReset.toLocaleTimeString()
          : 'later';
        setShareError(
          `GitHub rate limit reached (60 requests per hour). ` +
          `Try again after ${resetTime}, or use the instant link option below!`
        );
      } else if (result.errorType === 'network') {
        window.umami?.track('share-gist-network-error');
        setShareError(
          'Network error creating Gist. Please check your connection and try again.'
        );
      } else {
        window.umami?.track('share-gist-error', { error: result.error || 'unknown' });
        setShareError(`Could not create Gist: ${result.error}`);
      }
    }
  };

  const handleCopyGistUrl = async () => {
    if (!gistUrl) return;

    setIsCopyingUrl('gist');
    const success = await copyToClipboard(gistUrl);
    setIsCopyingUrl(null);

    if (success) {
      window.umami?.track('share-gist-url-copied');
    } else {
      setShareError('Failed to copy URL. Please try selecting and copying manually.');
    }
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
        <div
          className="share-modal-overlay"
          onClick={() => setShowShareModal(false)}
        >
          <div
            className="share-modal"
            onClick={(e) => e.stopPropagation()}
          >
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

            {shareModalState === 'loading' && (
              <div className="share-modal-content">
                <div className="loading-spinner"></div>
                <p>Preparing to share...</p>
              </div>
            )}

            {shareModalState === 'options' && (
              <div className="share-modal-content">
                <div className="share-options">

                  {/* Instant Link Option */}
                  <div className="share-option">
                    <div className="share-option-header">
                      <h4>🔗 Instant Link</h4>
                      {!dataUrlResult?.tooLarge && (
                        <span className="share-option-badge">Recommended</span>
                      )}
                    </div>
                    <p>
                      Copy a link with your presentation embedded.
                      No servers required, works instantly!
                    </p>

                    {dataUrlResult?.success && !dataUrlResult.tooLarge && (
                      <>
                        {dataUrlResult.warningSize && (
                          <p className="share-option-warning">
                            ⚠️ Large presentation - link may not work in all browsers
                          </p>
                        )}
                        <button
                          className="share-option-button"
                          onClick={handleCopyDataUrl}
                          disabled={isCopyingUrl === 'dataurl'}
                        >
                          {isCopyingUrl === 'dataurl' ? 'Copying...' : 'Copy Instant Link'}
                        </button>
                      </>
                    )}

                    {dataUrlResult?.tooLarge && (
                      <p className="share-option-error">
                        ❌ Presentation is too large for instant link ({">"} 100KB).
                        Try GitHub Gist below instead.
                      </p>
                    )}

                    {!dataUrlResult?.success && dataUrlResult && (
                      <p className="share-option-error">
                        Failed to generate link: {dataUrlResult.error}
                      </p>
                    )}
                  </div>

                  {/* GitHub Gist Option */}
                  <div className="share-option">
                    <div className="share-option-header">
                      <h4>📝 GitHub Gist</h4>
                      {dataUrlResult?.tooLarge && (
                        <span className="share-option-badge">Recommended</span>
                      )}
                    </div>
                    <p>
                      Create a permanent, shareable URL hosted on GitHub.
                      Perfect for large presentations!
                    </p>

                    {!gistUrl && (
                      <button
                        className="share-option-button secondary"
                        onClick={handleCreateGist}
                        disabled={isCreatingGist}
                      >
                        {isCreatingGist ? 'Creating Gist...' : 'Create GitHub Gist'}
                      </button>
                    )}

                    {gistUrl && (
                      <>
                        <input
                          type="text"
                          value={gistUrl}
                          readOnly
                          className="share-url-input"
                          onClick={(e) => e.currentTarget.select()}
                        />
                        <button
                          className="share-option-button"
                          onClick={handleCopyGistUrl}
                          disabled={isCopyingUrl === 'gist'}
                        >
                          {isCopyingUrl === 'gist' ? 'Copying...' : 'Copy Gist URL'}
                        </button>
                      </>
                    )}
                  </div>

                  {/* Traditional Options */}
                  <div className="share-option">
                    <div className="share-option-header">
                      <h4>💾 Traditional Options</h4>
                    </div>
                    <p>
                      Classic sharing methods for offline use or manual hosting.
                    </p>
                    <div className="share-button-group">
                      <button
                        onClick={() => {
                          handleDownload();
                          window.umami?.track('share-modal-download');
                        }}
                      >
                        ⬇️ Download
                      </button>
                      <button
                        onClick={() => {
                          handleOpenInNewTab();
                          window.umami?.track('share-modal-new-tab');
                        }}
                      >
                        🗗 New Tab
                      </button>
                    </div>
                  </div>
                </div>

                {/* Error Display */}
                {shareError && (
                  <div className="share-error">
                    {shareError}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
