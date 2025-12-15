import { useState, useCallback, useEffect, useRef } from 'react';
import { ApiKeyInput } from './components/ApiKeyInput';
import { DirectoryPicker } from './components/DirectoryPicker';
import { AgentProgress } from './components/AgentProgress';
import { PhaseIndicator } from './components/PhaseIndicator';
import { createExplorationAgent } from './agents/ExplorationAgent';
import { createCodeWriterAgent, parseInsightsFromResult } from './agents/CodeWriterAgent';
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
  type AgentCheckpoint,
} from './services/persistence';
import { Logger } from './services/logger';
import './App.css';

type AppStep = 'api-key' | 'directory' | 'exploring' | 'writing-code' | 'results';

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

  // Logger for writing to local log file
  const loggerRef = useRef<Logger | null>(null);

  // Check for saved state on mount
  useEffect(() => {
    const savedApiKey = loadApiKey();
    const savedSession = loadSession();
    const savedCheckpoint = loadCheckpoint();

    if (savedApiKey) {
      setApiKey(savedApiKey);
      setStep('directory');
    }

    if (savedSession && savedCheckpoint && savedCheckpoint.status !== 'running') {
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
          // Parse insights from result
          const generatedInsights = parseInsightsFromResult(event.result);
          setInsights(generatedInsights);
          setResult(event.result);
          setStep('results');
          setStopFn(null);
          // Clear checkpoint on successful completion
          clearSession();
          // Flush logs
          loggerRef.current?.forceFlush();
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

  const handleResume = useCallback(async () => {
    const checkpoint = loadCheckpoint();
    if (!checkpoint || !apiKey) return;

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
  }, [apiKey, startExploration]);

  const handleDiscardSession = useCallback(() => {
    clearSession();
    setHasResumableSession(false);
    setResumableInfo(null);
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
  }, []);

  return (
    <div className="app">
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
                      Folder: {resumableInfo.directoryName} •{' '}
                      {resumableInfo.discoveries} discoveries
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
            <DirectoryPicker onDirectorySelected={handleDirectorySelected} />
          </>
        )}

        {(step === 'exploring' || step === 'writing-code' || step === 'results') && (
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

            <AgentProgress
              events={events}
              result={result}
              onStop={step === 'exploring' || step === 'writing-code' ? handleStop : undefined}
              insights={insights}
            />
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
