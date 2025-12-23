import { useState, useCallback, useEffect, useRef } from 'react';
import { ApiKeyInput } from './components/ApiKeyInput';
import { DirectoryPicker } from './components/DirectoryPicker';
import { AgentProgress } from './components/AgentProgress';
import { PhaseIndicator } from './components/PhaseIndicator';
import { PresentationView } from './components/PresentationView';
import { createExplorationAgent } from './agents/ExplorationAgent';
import { createCodeWriterAgent, parseInsightsFromResult } from './agents/CodeWriterAgent';
import { createPresentationAgent, extractPresentationHtml } from './agents/PresentationAgent';
import { PresentationExecutor } from './services/presentationExecution';
import type { CheckpointData } from './agents/AgentRunner';
import type { AgentEvent, AgentResult } from './agents/types';
import type { Insight } from './types/insights';
import {
  saveApiKey,
  loadApiKey,
  saveSession,
  loadSession,
  saveCheckpoint,
  loadCheckpoint,
  clearSession,
  generateSessionId,
  saveCodeWriterResult,
  loadCodeWriterResult,
  clearCodeWriterResult,
  type AgentCheckpoint,
} from './services/persistence';
import { Logger } from './services/logger';
import './App.css';

type AppStep = 'api-key' | 'directory' | 'exploring' | 'writing-code' | 'presenting' | 'results';

function App() {
  const [step, setStep] = useState<AppStep>('api-key');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [directoryHandle, setDirectoryHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [stopFn, setStopFn] = useState<(() => void) | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hasResumableSession, setHasResumableSession] = useState(false);
  const [resumableInfo, setResumableInfo] = useState<{
    directoryName: string;
    discoveries: number;
  } | null>(null);

  // Code writing phase state
  const [insights, setInsights] = useState<Insight[]>([]);

  // Presentation phase state
  const [presentationExecutor, setPresentationExecutor] = useState<PresentationExecutor | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | undefined>(undefined);
  const presentationStartedRef = useRef(false); // Use ref for synchronous check
  const [finalPresentationHtml, setFinalPresentationHtml] = useState<string | null>(null);
  const [hasSavedCodeWriterResult, setHasSavedCodeWriterResult] = useState(false);

  // Logger for writing to local log file
  const loggerRef = useRef<Logger | null>(null);

  // Check for saved state on mount
  useEffect(() => {
    const savedApiKey = loadApiKey();
    const savedSession = loadSession();
    const savedCheckpoint = loadCheckpoint();
    const savedCodeWriterResult = loadCodeWriterResult();

    if (savedApiKey) {
      setApiKey(savedApiKey);
      setStep('directory');
    }

    // Check if we have a resumable session
    // Priority: code writer result (presentation phase) > checkpoint (exploration phase)
    if (savedCodeWriterResult) {
      setHasResumableSession(true);
      setResumableInfo({
        directoryName: savedSession?.directoryName || 'Unknown',
        discoveries: -1, // Special marker for presentation phase
      });
      setHasSavedCodeWriterResult(true);
    } else if (savedSession && savedCheckpoint && savedCheckpoint.status !== 'running') {
      setHasResumableSession(true);
      setResumableInfo({
        directoryName: savedSession.directoryName,
        discoveries: savedCheckpoint.discoveries.length,
      });
    }
  }, []);

  const handleApiKeySet = useCallback((key: string) => {
    setApiKey(key);
    saveApiKey(key);
    setStep('directory');
  }, []);

  const handleCheckpoint = useCallback(
    (data: CheckpointData) => {
      if (!sessionId) return;

      const checkpoint: AgentCheckpoint = {
        sessionId,
        messages: data.messages,
        discoveries: data.discoveries,
        tokenUsage: data.tokenUsage,
        iteration: data.iteration,
        status: 'paused',
        lastUpdatedAt: new Date().toISOString(),
      };

      saveCheckpoint(checkpoint);
    },
    [sessionId]
  );

  const startPresentation = useCallback(
    async (codeWriterResult: AgentResult, container: HTMLDivElement) => {
      if (!apiKey) {
        console.error('No API key available');
        return;
      }

      if (presentationStartedRef.current) {
        console.log('Presentation already started, skipping');
        return;
      }

      console.log('Starting presentation');
      presentationStartedRef.current = true;

      // Extract code output from the last successful execute_code tool result
      let codeOutput = 'No insights generated yet.';

      for (let i = codeWriterResult.conversationHistory.length - 1; i >= 0; i--) {
        const msg = codeWriterResult.conversationHistory[i];
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'tool_result' && typeof block.content === 'string' && block.content.includes('✅ Code executed successfully')) {
              codeOutput = block.content;
              break;
            }
          }
          if (codeOutput !== 'No insights generated yet.') break;
        }
      }

      console.log('Code output length:', codeOutput.length);
      console.log('Summary:', codeWriterResult.summary.substring(0, 100));

      // Log phase transition
      loggerRef.current?.log('system', 'Starting presentation phase');

      try {
        // Create executor
        const executor = new PresentationExecutor(container);
        setPresentationExecutor(executor);
        console.log('PresentationExecutor created');

        const agent = createPresentationAgent({
          codeOutput,
          summary: codeWriterResult.summary,
          userName,
          executor,
          apiKey,
          onCheckpoint: handleCheckpoint,
          onScreenshot: (dataUrl) => {
            console.log('Screenshot captured');
            setScreenshot(dataUrl);
          },
        });
        console.log('PresentationAgent created');

        // Store stop function
        setStopFn(() => () => agent.stop());

        // Subscribe to events
        agent.on((event) => {
          console.log('Presentation event:', event.type);
          setEvents((prev) => [...prev, event]);

          // Log event
          loggerRef.current?.logEvent('presentation', event);

          if (event.type === 'complete') {
            console.log('Presentation complete');

            // Extract final HTML before transitioning
            const html = extractPresentationHtml(event.result);
            if (html) {
              setFinalPresentationHtml(html);
              console.log('Saved final presentation HTML');
            }

            // Clean up the executor - will be recreated with new container
            if (presentationExecutor) {
              presentationExecutor.destroy();
              setPresentationExecutor(null);
            }

            setResult(event.result);
            setStep('results');
            setStopFn(null);
            presentationStartedRef.current = false;
            // Clear checkpoint on successful completion
            clearSession();
            // Flush logs
            loggerRef.current?.forceFlush();
          }

          if (event.type === 'status_change' && event.status === 'error') {
            console.error('Presentation agent error status');
            // Keep checkpoint for recovery
            setStopFn(null);
            presentationStartedRef.current = false;
          }

          if (event.type === 'error') {
            console.error('Presentation agent error event:', event.error);
            presentationStartedRef.current = false;
          }
        });

        // Start presentation generation
        console.log('Starting agent.run()');
        await agent.run();
        console.log('agent.run() completed');
      } catch (error) {
        console.error('Presentation agent error:', error);
        setEvents((prev) => [
          ...prev,
          { type: 'error', error: (error as Error).message },
        ]);
        setStopFn(null);
        presentationStartedRef.current = false;
      }
    },
    [apiKey, userName, handleCheckpoint]
  );

  const startCodeWriting = useCallback(
    async (
      handle: FileSystemDirectoryHandle,
      explorationResult: AgentResult
    ) => {
      if (!apiKey) return;

      // Log phase transition
      loggerRef.current?.log('system', 'Starting code writing phase');

      const agent = createCodeWriterAgent({
        rootHandle: handle,
        discoveries: explorationResult.discoveries,
        apiKey,
        onCheckpoint: handleCheckpoint,
      });

      // Store stop function
      setStopFn(() => () => agent.stop());

      // Subscribe to events
      agent.on((event) => {
        setEvents((prev) => [...prev, event]);

        // Log event
        loggerRef.current?.logEvent('code-writing', event);

        if (event.type === 'complete') {
          // Parse insights from result for display
          const generatedInsights = parseInsightsFromResult(event.result);
          setInsights(generatedInsights);

          // Try to extract user name from conversation
          for (const msg of event.result.conversationHistory) {
            if (msg.role === 'user' && Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (block.type === 'tool_result' && typeof block.content === 'string') {
                  const nameMatch = block.content.match(/userName['":\s]+['"]([^'"]+)['"]/);
                  if (nameMatch) {
                    setUserName(nameMatch[1]);
                    console.log('Found user name:', nameMatch[1]);
                    break;
                  }
                }
              }
            }
          }

          setResult(event.result);
          setStopFn(null);

          // Save code writer result for quick presentation testing
          saveCodeWriterResult(event.result);
          setHasSavedCodeWriterResult(true);

          // Transition to presentation phase
          console.log('Transitioning to presentation phase');
          setStep('presenting');
          setEvents([]); // Clear events for new phase
          presentationStartedRef.current = false; // Reset flag
        }

        if (event.type === 'status_change' && event.status === 'error') {
          // Keep checkpoint for recovery
          setStopFn(null);
        }
      });

      // Start code writing
      try {
        await agent.run();
      } catch (error) {
        console.error('Code writing agent error:', error);
        setEvents((prev) => [
          ...prev,
          { type: 'error', error: (error as Error).message },
        ]);
        setStopFn(null);
      }
    },
    [apiKey, handleCheckpoint]
  );

  const startExploration = useCallback(
    async (
      handle: FileSystemDirectoryHandle,
      resumeFrom?: CheckpointData
    ) => {
      if (!apiKey) return;

      const newSessionId = resumeFrom ? sessionId : generateSessionId();
      setSessionId(newSessionId);

      // Initialize logger
      if (!loggerRef.current) {
        loggerRef.current = new Logger(handle, newSessionId!);
        loggerRef.current.log('system', `Session started: ${handle.name}`);
      }

      // Save session info
      saveSession({
        directoryName: handle.name,
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });

      loggerRef.current.log('system', 'Starting exploration phase');

      const agent = createExplorationAgent({
        rootHandle: handle,
        apiKey,
        onCheckpoint: handleCheckpoint,
        resumeFrom,
      });

      // Store stop function
      setStopFn(() => () => agent.stop());

      // Subscribe to events
      agent.on((event) => {
        setEvents((prev) => [...prev, event]);

        // Log event
        loggerRef.current?.logEvent('exploration', event);

        if (event.type === 'complete') {
          // Transition to code writing
          setStopFn(null);
          setStep('writing-code');

          // Automatically start code writing
          setTimeout(() => {
            startCodeWriting(handle, event.result);
          }, 100);
        }

        if (event.type === 'status_change' && event.status === 'error') {
          // Keep checkpoint for recovery
          setStopFn(null);
        }
      });

      // Start exploration
      try {
        await agent.run();
      } catch (error) {
        console.error('Agent error:', error);
        setEvents((prev) => [
          ...prev,
          { type: 'error', error: (error as Error).message },
        ]);
        setStopFn(null);
      }
    },
    [apiKey, sessionId, handleCheckpoint, startCodeWriting]
  );

  const handleDirectorySelected = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      setDirectoryHandle(handle);
      setStep('exploring');
      setEvents([]);
      setResult(null);
      setHasResumableSession(false);
      setResumableInfo(null);

      await startExploration(handle);
    },
    [startExploration]
  );

  const handleSkipToPresentation = useCallback(() => {
    const savedResult = loadCodeWriterResult();
    if (!savedResult) {
      console.error('No saved code writer result found');
      return;
    }

    console.log('Skipping to presentation with saved data');

    // Parse insights for display
    const generatedInsights = parseInsightsFromResult(savedResult);
    setInsights(generatedInsights);

    // Extract user name
    for (const msg of savedResult.conversationHistory) {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result' && typeof block.content === 'string') {
            const nameMatch = block.content.match(/userName['":\s]+['"]([^'"]+)['"]/);
            if (nameMatch) {
              setUserName(nameMatch[1]);
              break;
            }
          }
        }
      }
    }

    setResult(savedResult);
    setStep('presenting');
    setEvents([]);
    presentationStartedRef.current = false;
  }, []);

  const handleResume = useCallback(async () => {
    if (!apiKey) return;

    const savedCodeWriterResult = loadCodeWriterResult();
    const checkpoint = loadCheckpoint();

    // If we have a saved code writer result, resume from presentation phase
    if (savedCodeWriterResult) {
      console.log('Resuming from presentation phase with saved code writer result');
      setHasResumableSession(false);
      setResumableInfo(null);
      handleSkipToPresentation();
      return;
    }

    // Otherwise, resume from exploration phase
    if (!checkpoint) {
      console.error('No checkpoint found for resume');
      return;
    }

    // User needs to re-select the directory (can't persist FileSystemDirectoryHandle)
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });

      setDirectoryHandle(handle);
      setStep('exploring');
      setEvents([]);
      setResult(null);
      setHasResumableSession(false);
      setResumableInfo(null);

      await startExploration(handle, {
        messages: checkpoint.messages,
        discoveries: checkpoint.discoveries,
        tokenUsage: checkpoint.tokenUsage,
        iteration: checkpoint.iteration,
      });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Error resuming:', error);
      }
    }
  }, [apiKey, startExploration, handleSkipToPresentation]);

  const handleDiscardSession = useCallback(() => {
    clearSession();
    clearCodeWriterResult();
    setHasResumableSession(false);
    setResumableInfo(null);
    setHasSavedCodeWriterResult(false);
  }, []);

  const handleStop = useCallback(() => {
    stopFn?.();
    setStopFn(null);
  }, [stopFn]);

  const handleReset = useCallback(() => {
    setStep('directory');
    setEvents([]);
    setResult(null);
    setStopFn(null);
    setFinalPresentationHtml(null);
    presentationStartedRef.current = false;
    // Clean up executor
    if (presentationExecutor) {
      presentationExecutor.destroy();
      setPresentationExecutor(null);
    }
  }, [presentationExecutor]);

  return (
    <div className={`app ${step === 'presenting' || step === 'results' ? 'presentation-mode' : ''}`}>
      <header className="app-header">
        <h1>Year in Review</h1>
        <p>Create personalized year-end summaries from your exported data</p>
      </header>

      <main className="app-main">
        {step === 'api-key' && <ApiKeyInput onApiKeySet={handleApiKeySet} />}

        {step === 'directory' && (
          <>
            {hasResumableSession && resumableInfo && (
              <div className="resume-banner">
                <div className="resume-info">
                  <span className="resume-icon">💾</span>
                  <div>
                    <strong>Previous session found</strong>
                    <p>
                      {resumableInfo.discoveries === -1 ? (
                        <>Resume from presentation phase</>
                      ) : (
                        <>
                          Folder: {resumableInfo.directoryName} •{' '}
                          {resumableInfo.discoveries} discoveries
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <div className="resume-actions">
                  <button className="resume-button" onClick={handleResume}>
                    Resume
                  </button>
                  <button
                    className="discard-button"
                    onClick={handleDiscardSession}
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
            {hasSavedCodeWriterResult && !hasResumableSession && (
              <div className="resume-banner" style={{ marginBottom: '1rem' }}>
                <div className="resume-info">
                  <span className="resume-icon">🎨</span>
                  <div>
                    <strong>Test Presentation</strong>
                    <p>
                      Skip to presentation with saved insights (for development)
                    </p>
                  </div>
                </div>
                <div className="resume-actions">
                  <button className="resume-button" onClick={handleSkipToPresentation}>
                    Skip to Presentation
                  </button>
                </div>
              </div>
            )}
            <DirectoryPicker onDirectorySelected={handleDirectorySelected} />
          </>
        )}

        {(step === 'exploring' || step === 'writing-code' || step === 'presenting' || step === 'results') && (
          <>
            <div className="exploration-header">
              <h2>{directoryHandle?.name || 'Unknown folder'}</h2>
              {step === 'results' && (
                <button className="secondary-button" onClick={handleReset}>
                  Explore Another Folder
                </button>
              )}
            </div>

            {/* High-level phase indicator */}
            <PhaseIndicator currentPhase={step} />

            {/* Show agent progress for exploration and code writing */}
            {(step === 'exploring' || step === 'writing-code') && (
              <AgentProgress
                events={events}
                result={result}
                onStop={handleStop}
                insights={insights}
              />
            )}

            {/* Show presentation view during presentation phase */}
            {step === 'presenting' && (
              <>
                <PresentationView
                  isGenerating={true}
                  screenshot={screenshot}
                  onContainerReady={(container) => {
                    // Start presentation agent when container is ready
                    if (result) {
                      startPresentation(result, container);
                    }
                  }}
                />
                <AgentProgress
                  events={events}
                  result={result}
                  onStop={handleStop}
                  insights={insights}
                />
              </>
            )}

            {/* Show final result with presentation */}
            {step === 'results' && (
              <>
                <PresentationView
                  isGenerating={false}
                  screenshot={screenshot}
                  onContainerReady={(container) => {
                    // Re-render final presentation with saved HTML
                    if (finalPresentationHtml) {
                      // Always create new executor for results phase with fresh container
                      console.log('Re-rendering final presentation with new executor');
                      const executor = new PresentationExecutor(container);
                      setPresentationExecutor(executor);
                      executor.execute(finalPresentationHtml);
                    }
                  }}
                />
                <AgentProgress
                  events={events}
                  result={result}
                  insights={insights}
                />
              </>
            )}
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>
          Your data never leaves your browser. All processing happens locally.
          {sessionId && <span className="session-id"> Session: {sessionId.slice(-8)}</span>}
        </p>
      </footer>
    </div>
  );
}

export default App;
