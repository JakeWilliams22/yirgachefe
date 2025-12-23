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
import type { Message } from './services/anthropic';
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
  saveIterationCheckpoint,
  type AgentCheckpoint,
  type IterationCheckpoint,
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
  const [explorationResult, setExplorationResult] = useState<AgentResult | null>(null);
  const [codeWritingResult, setCodeWritingResult] = useState<AgentResult | null>(null);
  const [presentationResult, setPresentationResult] = useState<AgentResult | null>(null);
  const [stopFn, setStopFn] = useState<(() => void) | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [allConversationHistory, setAllConversationHistory] = useState<Message[]>([]);
  const [hasResumableSession, setHasResumableSession] = useState(false);
  const [resumableInfo, setResumableInfo] = useState<{
    directoryName: string;
    discoveries: number;
  } | null>(null);
  const [isPrivacySectionExpanded, setIsPrivacySectionExpanded] = useState(false);
  const [isMotivationSectionExpanded, setIsMotivationSectionExpanded] = useState(true);

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
    (data: CheckpointData, iteration: number) => {
      if (!sessionId) return;

      // Save to old system for backwards compatibility
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

      // Save to new multi-iteration system
      const iterationCheckpoint: IterationCheckpoint = {
        iteration,
        timestamp: new Date().toISOString(),
        messages: data.messages,
        discoveries: data.discoveries,
        tokenUsage: data.tokenUsage,
      };
      saveIterationCheckpoint(sessionId, iterationCheckpoint, 'exploration');
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

      // Add phase transition marker to conversation history
      setAllConversationHistory((prev) => [
        ...prev,
        {
          role: 'user',
          content: '--- PHASE TRANSITION: PRESENTATION AGENT --- \n\nREMINDER: We are creating a 2025 Year in Review presentation. Use the insights from 2025 data.',
        },
      ]);

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

          // Accumulate conversation history
          if (event.type === 'conversation_update') {
            setAllConversationHistory((prev) => {
              // Only add new messages that aren't already in prev
              if (prev.length > 0 && event.messages.length > prev.length) {
                const newMessages = event.messages.slice(prev.length);
                return [...prev, ...newMessages];
              }
              return event.messages;
            });
          }

          if (event.type === 'complete') {
            console.log('Presentation complete');

            // Add final conversation to cumulative history
            setAllConversationHistory((prev) => {
              const newMessages = event.result.conversationHistory.slice(prev.length);
              return [...prev, ...newMessages];
            });

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

            // Store presentation result (keep code writing result too!)
            setPresentationResult(event.result);
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

      // Add phase transition marker to conversation history
      setAllConversationHistory((prev) => [
        ...prev,
        {
          role: 'user',
          content: '--- PHASE TRANSITION: CODE WRITING AGENT --- \n\nREMINDER: We are creating a 2025 Year in Review. Focus on 2025 data and insights.',
        },
      ]);

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

        // Accumulate conversation history
        if (event.type === 'conversation_update') {
          setAllConversationHistory((prev) => {
            // Only add new messages that aren't already in prev
            if (prev.length > 0 && event.messages.length > prev.length) {
              const newMessages = event.messages.slice(prev.length);
              return [...prev, ...newMessages];
            }
            return event.messages;
          });
        }

        if (event.type === 'complete') {
          // Add final conversation to cumulative history
          setAllConversationHistory((prev) => {
            const newMessages = event.result.conversationHistory.slice(prev.length);
            return [...prev, ...newMessages];
          });

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

          // Store code writing result
          setCodeWritingResult(event.result);
          setResult(event.result);
          setStopFn(null);

          // Save code writer result for quick presentation testing
          saveCodeWriterResult(event.result);
          setHasSavedCodeWriterResult(true);

          // Transition to presentation phase
          console.log('Transitioning to presentation phase');
          setStep('presenting');
          // Don't clear events - preserve conversation history
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

        // Accumulate conversation history
        if (event.type === 'conversation_update') {
          setAllConversationHistory(event.messages);
        }

        if (event.type === 'complete') {
          // Store final conversation
          setAllConversationHistory(event.result.conversationHistory);

          // Store exploration result
          setExplorationResult(event.result);
          setResult(event.result); // Also set as current result

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
      setExplorationResult(null);
      setCodeWritingResult(null);
      setPresentationResult(null);
      setAllConversationHistory([]); // Clear conversation history for new session
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

  const handleRetryPresentation = useCallback(() => {
    // Load the saved code writer result
    const savedResult = loadCodeWriterResult();
    if (!savedResult) {
      console.error('No saved code writer result found');
      alert('Cannot retry - no saved insights found. Please run the full pipeline again.');
      return;
    }

    console.log('Retrying presentation with saved insights');

    // Clean up current executor
    if (presentationExecutor) {
      presentationExecutor.destroy();
      setPresentationExecutor(null);
    }

    // Reset presentation state but keep earlier conversation history
    // Find the index where presentation agent started (look for phase transition marker)
    const presentationStartIndex = allConversationHistory.findIndex(
      (msg) => msg.role === 'user' &&
      typeof msg.content === 'string' &&
      msg.content.includes('PHASE TRANSITION: PRESENTATION AGENT')
    );

    if (presentationStartIndex !== -1) {
      // Keep everything before the presentation phase
      setAllConversationHistory((prev) => prev.slice(0, presentationStartIndex));
    }

    setEvents([]);
    setResult(savedResult);
    setFinalPresentationHtml(null);
    presentationStartedRef.current = false;

    // Go back to presenting step
    setStep('presenting');
  }, [presentationExecutor, allConversationHistory]);

  // Handle editing a message in the conversation history
  const handleMessageEdit = useCallback((index: number, newMessage: Message) => {
    console.log('Editing message at index:', index);

    // Update the conversation history
    setAllConversationHistory((prev) => {
      const updated = [...prev];
      updated[index] = newMessage;
      return updated;
    });

    // If we have a session, save as a new checkpoint with the edited conversation
    if (sessionId) {
      const iterationCheckpoint: IterationCheckpoint = {
        iteration: -1, // Special marker for manually edited checkpoint
        timestamp: new Date().toISOString(),
        messages: allConversationHistory.map((msg, i) => i === index ? newMessage : msg),
        discoveries: result?.discoveries || [],
        tokenUsage: result?.tokenUsage || { input: 0, output: 0 },
        label: `Edited at message ${index}`,
      };

      // Determine agent type based on current step
      const agentType = step === 'exploring' ? 'exploration'
        : step === 'writing-code' ? 'code-writing'
        : 'presentation';

      saveIterationCheckpoint(sessionId, iterationCheckpoint, agentType);
      console.log('Saved edited checkpoint');
    }
  }, [sessionId, allConversationHistory, result, step]);

  // Handle resuming from a specific checkpoint
  const handleResumeFromCheckpoint = useCallback(async (checkpoint: IterationCheckpoint) => {
    console.log('Resuming from checkpoint iteration:', checkpoint.iteration);

    // Stop any currently running agent
    if (stopFn) {
      console.log('Stopping current agent...');
      stopFn();
      setStopFn(null);
    }

    // Restore conversation history from checkpoint
    setAllConversationHistory(checkpoint.messages);
    setEvents([]);
    setResult(null);

    // For now, we'll need the user to restart the agent manually with the edited state
    // A full implementation would call agent.resumeFromIteration() here
    // But that requires knowing which agent was running and having access to directory handle

    alert('Checkpoint loaded. The conversation has been restored to iteration ' + checkpoint.iteration +
          '. You can now review the messages or continue manually.');

    // TODO: Implement full resume functionality with AgentRunner.resumeFromIteration()
  }, [stopFn]);

  // Compute cumulative state from all agent phases
  const cumulativeTokenUsage = {
    input:
      (explorationResult?.tokenUsage.input || 0) +
      (codeWritingResult?.tokenUsage.input || 0) +
      (presentationResult?.tokenUsage.input || 0),
    output:
      (explorationResult?.tokenUsage.output || 0) +
      (codeWritingResult?.tokenUsage.output || 0) +
      (presentationResult?.tokenUsage.output || 0),
  };

  const allDiscoveries = [
    ...(explorationResult?.discoveries || []),
    ...(codeWritingResult?.discoveries || []),
    ...(presentationResult?.discoveries || []),
  ];

  // Create a combined result for display purposes
  const displayResult = result ? {
    ...result,
    tokenUsage: cumulativeTokenUsage,
    discoveries: allDiscoveries,
  } : null;

  return (
    <div className={`app ${step === 'presenting' || step === 'results' ? 'presentation-mode' : ''}`}>
      <header className="app-header">
        <h1>
          yirgachefe ☕
        </h1>
        <p>Create personalized year-end summaries from your exported data</p>
        <p>Note: This is an experimental project. Data exports often contain sensitive data. Use at your own risk. Expand the privacy section for more information. </p>
      </header>

      <div className="privacy-section">
        <button
          className="privacy-toggle"
          onClick={() => setIsPrivacySectionExpanded(!isPrivacySectionExpanded)}
          aria-expanded={isPrivacySectionExpanded}
        >
          <span className="privacy-toggle-icon">{isPrivacySectionExpanded ? '▼' : '▶'}</span>
          <span className="privacy-toggle-text">Privacy Information</span>
        </button>
        {isPrivacySectionExpanded && (
          <div className="privacy-content">
          <h3>Disclaimer</h3>
          <p>
            <strong>This app is provided "as is" without any warranties. By using this app, you acknowledge that you do so at your own risk. The creator is not responsible for any damages, data loss, or other issues that may result from using this application.</strong>
          </p>
          <h3>How Your Data is Handled</h3>
          <p>
            This app is a demonstration of what's possible with claude code & the latest Claude models as of December 2025 (sonnet 4.5 and opus 4.5). The code is almost entirely generated by AI. 
          </p>
          <p>
            We aimed to:
          </p>
          <ul>
            <li>Make API calls only for LLM generations (Claude API) and some basic usage stats.</li>
            <li>Store any state locally in your browser and on your file system.</li>
          </ul>
          <p>
            The code that backs this app was not reviewed by anyone well-versed in security. Much of this code was not reviewed at all.
          </p>
          <p>
            This app runs LLM-generated code on your data &amp; the files you give it access to. As with all LLM-generated code, there is no guarantee that what it does is safe.
          </p>
        </div>
        )}
      </div>

      <div className="privacy-section">
        <button
          className="privacy-toggle"
          onClick={() => setIsMotivationSectionExpanded(!isMotivationSectionExpanded)}
          aria-expanded={isMotivationSectionExpanded}
        >
          <span className="privacy-toggle-icon">{isMotivationSectionExpanded ? '▼' : '▶'}</span>
          <span className="privacy-toggle-text">About & Instructions</span>
        </button>
        {isMotivationSectionExpanded && (
          <div className="privacy-content">
            {/* Content placeholder - user will fill this in */}
            <h3>Motivation</h3>
            <p>
              Like it or not &mdash; every second you spend online is tracked.
            </p>
            <p>
              For 11 months of the year, we can use this data for its true purpose: generating revenue. But December is a time to use that data for a brief moment of delight—a glimpse into our soul—or to make sure your friends know your #1 artist is someone niche (you're not that mainstream).

              <br /><br />

              Unfortunately, not all of your services nicely wrap up your year for you. Some even make you pay for it!

              <br /><br />

              The most popular services have dedicated websites built for their specific export format, but there's no guarantee those sites handle your data responsibly or even work with this year's export format. I wanted to make a mostly browser-side service that would work for <em>any</em> data I gave it.
            </p>
            <h3>How it works</h3>
            <ol>
              <li>
                Request an export of your data from your trusty {`{MusicStreamingService|FitnessTracker|TerminalHistory|BookReadingSocialMedia}`}
              </li>
              <li>
                Wait <code>n</code> hours to receive your data
              </li>
              <li>
                Select the directory with your unzipped, exported data in Yirgachefe.
              </li>
              <li>
                A data exploration agent tries to understand the shape of your exported data, including what kind of data it is, and who it belongs to. 
              </li>
              <li>
                An "analysis" agent comes up with some interesting insights that highlight your accomplishments, and writes in-browser javascript to extract the insights from the files you provided.
              </li>
              <li>
                A "presentation" agent iterates on an <code>&lt;iframe&gt;</code> based presentation  to give you your findings in a fun and lighthearted sequence of screens reminiscent of 2005 era powerpoint. 
              </li>
            </ol>
          </div>
        )}
      </div>

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
              {step === 'presenting' && (
                <button className="secondary-button" onClick={handleRetryPresentation}>
                  🔄 Retry Presentation
                </button>
              )}
              {step === 'results' && (
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="secondary-button" onClick={handleRetryPresentation}>
                    🔄 Retry Presentation
                  </button>
                  <button className="secondary-button" onClick={handleReset}>
                    Explore Another Folder
                  </button>
                </div>
              )}
            </div>

            {/* High-level phase indicator */}
            <PhaseIndicator currentPhase={step} />

            {/* Show agent progress for exploration and code writing */}
            {(step === 'exploring' || step === 'writing-code') && (
              <AgentProgress
                events={events}
                result={displayResult}
                onStop={handleStop}
                insights={insights}
                sessionId={sessionId || undefined}
                allMessages={allConversationHistory}
                onResumeFromCheckpoint={handleResumeFromCheckpoint}
                onMessageEdit={handleMessageEdit}
                explorationResult={explorationResult}
                codeWritingResult={codeWritingResult}
                presentationResult={presentationResult}
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
                  result={displayResult}
                  onStop={handleStop}
                  insights={insights}
                  sessionId={sessionId || undefined}
                  allMessages={allConversationHistory}
                  onResumeFromCheckpoint={handleResumeFromCheckpoint}
                  onMessageEdit={handleMessageEdit}
                  explorationResult={explorationResult}
                  codeWritingResult={codeWritingResult}
                  presentationResult={presentationResult}
                />
              </>
            )}

            {/* Show final result with presentation */}
            {step === 'results' && (
              <>
                <PresentationView
                  isGenerating={false}
                  screenshot={screenshot}
                  html={finalPresentationHtml}
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
                  result={displayResult}
                  insights={insights}
                  sessionId={sessionId || undefined}
                  allMessages={allConversationHistory}
                  onResumeFromCheckpoint={handleResumeFromCheckpoint}
                  onMessageEdit={handleMessageEdit}
                  explorationResult={explorationResult}
                  codeWritingResult={codeWritingResult}
                  presentationResult={presentationResult}
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
