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
import { PROXY_MODE_KEY } from './services/anthropic';
import {
  saveApiKey,
  loadApiKey,
  saveSession,
  saveCheckpoint,
  clearSession,
  generateSessionId,
  saveCodeWriterResult,
  loadCodeWriterResult,
  saveIterationCheckpoint,
  type AgentCheckpoint,
  type IterationCheckpoint,
} from './services/persistence';
import { Logger } from './services/logger';
import { parseDataUrl } from './utils/shareUtils';
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
  const [isPrivacySectionExpanded, setIsPrivacySectionExpanded] = useState(false);
  const [isMotivationSectionExpanded, setIsMotivationSectionExpanded] = useState(true);

  // Code writing phase state
  const [insights, setInsights] = useState<Insight[]>([]);

  // Presentation phase state
  const [presentationExecutor, setPresentationExecutor] = useState<PresentationExecutor | null>(null);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [userName, setUserName] = useState<string | undefined>(undefined);
  const presentationStartedRef = useRef(false); // Use ref for synchronous check
  const [finalPresentationHtml, setFinalPresentationHtml] = useState<string | null>(null);
  const [hasSavedCodeWriterResult, setHasSavedCodeWriterResult] = useState(false);

  // Logger for writing to local log file
  const loggerRef = useRef<Logger | null>(null);

  // Check for saved state on mount
  useEffect(() => {
    const savedApiKey = loadApiKey();
    const savedCodeWriterResult = loadCodeWriterResult();

    if (savedApiKey) {
      setApiKey(savedApiKey);
      setStep('directory');
    }

    // Check if we have saved code writer result for dev testing
    if (savedCodeWriterResult) {
      setHasSavedCodeWriterResult(true);
    }
  }, []);

  // Check for shared presentation in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const compressed = params.get('p');

    if (compressed) {
      try {
        // Track view
        window.umami?.track('shared-presentation-viewed', {
          urlLength: window.location.href.length
        });

        // Decompress presentation HTML
        const html = parseDataUrl(compressed);

        // Set state to display presentation immediately
        setFinalPresentationHtml(html);
        setStep('results');

        // Optional: Clean URL bar (keeps history working)
        window.history.replaceState({}, '', window.location.pathname);

      } catch (error) {
        console.error('Failed to load shared presentation:', error);
        window.umami?.track('shared-presentation-error', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        // User-friendly error
        alert(
          'Failed to load shared presentation. The link may be corrupted or incomplete. ' +
          'Please ask the sender for a new link.'
        );
      }
    }
  }, []);

  const handleApiKeySet = useCallback((key: string) => {
    setApiKey(key);
    // Only save real API keys to localStorage, not demo mode
    if (key !== PROXY_MODE_KEY) {
      saveApiKey(key);
    }
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
    async (codeWriterResult: AgentResult, container: HTMLDivElement, additionalGuidance?: string) => {
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
          onScreenshot: (dataUrls) => {
            console.log('Screenshots captured:', `${dataUrls.length} screenshots`);
            setScreenshots(dataUrls);
          },
          additionalGuidance,
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
              // Find where the current agent's messages start (after any phase markers)
              // by finding the last phase transition marker
              let agentStartIndex = 0;
              for (let i = prev.length - 1; i >= 0; i--) {
                if (prev[i].role === 'user' &&
                    typeof prev[i].content === 'string' &&
                    (prev[i].content as string).includes('PHASE TRANSITION:')) {
                  agentStartIndex = i + 1;
                  break;
                }
              }

              // Replace messages from agent start onwards with fresh agent messages
              return [...prev.slice(0, agentStartIndex), ...event.messages];
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
      explorationResult: AgentResult,
      additionalGuidance?: string
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
        additionalGuidance,
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
            // Find where the current agent's messages start (after any phase markers)
            // by finding the last phase transition marker
            let agentStartIndex = 0;
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === 'user' &&
                  typeof prev[i].content === 'string' &&
                  (prev[i].content as string).includes('PHASE TRANSITION:')) {
                agentStartIndex = i + 1;
                break;
              }
            }

            // Replace messages from agent start onwards with fresh agent messages
            return [...prev.slice(0, agentStartIndex), ...event.messages];
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
      resumeFrom?: CheckpointData,
      additionalGuidance?: string
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
        additionalGuidance,
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

      // Track process start
      window.umami?.track('process-started', { directoryName: handle.name });

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

  const handleRetryPresentation = useCallback((providedGuidance?: string) => {
    // Load the saved code writer result
    const savedResult = loadCodeWriterResult();
    if (!savedResult) {
      console.error('No saved code writer result found');
      alert('Cannot retry - no saved insights found. Please run the full pipeline again.');
      return;
    }

    // Prompt for additional guidance if not provided
    const guidance = providedGuidance !== undefined
      ? providedGuidance
      : window.prompt('Optional: Add additional guidance for the presentation (or leave empty):');

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

    // Store guidance for when presentation container is ready
    (window as any).__retryPresentationGuidance = guidance || undefined;

    // Go back to presenting step
    setStep('presenting');
  }, [presentationExecutor, allConversationHistory]);

  const handleRetryExploration = useCallback(async () => {
    if (!directoryHandle) {
      alert('No directory selected');
      return;
    }

    // Prompt for additional guidance
    const guidance = window.prompt('Optional: Add additional guidance for the exploration (or leave empty):');

    // Stop current agent if running
    if (stopFn) {
      stopFn();
      setStopFn(null);
    }

    // Reset state
    setEvents([]);
    setResult(null);
    setExplorationResult(null);
    setCodeWritingResult(null);
    setPresentationResult(null);
    setAllConversationHistory([]);

    // Restart exploration
    await startExploration(directoryHandle, undefined, guidance || undefined);
  }, [directoryHandle, stopFn, startExploration]);

  const handleRetryCodeWriting = useCallback(async () => {
    if (!directoryHandle || !explorationResult) {
      alert('Cannot retry - missing exploration data');
      return;
    }

    // Prompt for additional guidance
    const guidance = window.prompt('Optional: Add additional guidance for code writing (or leave empty):');

    // Stop current agent if running
    if (stopFn) {
      stopFn();
      setStopFn(null);
    }

    // Reset code writing state but keep exploration
    const codeWritingStartIndex = allConversationHistory.findIndex(
      (msg) => msg.role === 'user' &&
      typeof msg.content === 'string' &&
      msg.content.includes('CODE WRITING AGENT')
    );

    if (codeWritingStartIndex !== -1) {
      setAllConversationHistory((prev) => prev.slice(0, codeWritingStartIndex));
    }

    setEvents([]);
    setResult(explorationResult);
    setCodeWritingResult(null);
    setPresentationResult(null);

    // Go back to code writing step
    setStep('writing-code');

    // Start code writing with guidance
    setTimeout(() => {
      startCodeWriting(directoryHandle, explorationResult, guidance || undefined);
    }, 100);
  }, [directoryHandle, explorationResult, stopFn, startCodeWriting, allConversationHistory]);

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
        <h2>Spotify Wrapped for any GDPR-exported data </h2>
        <h3 style={{ fontWeight: 400, marginTop: '0.35em', fontSize: '1.1em', color: '#888' }}>
          Eleven months of the year we use data for its true purpose: generating revenue. But for one glorious month we can do something fun with it. 
        </h3>
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
          <p></p>
          <p>Exported data is often sensitive.</p>
          <h3>Disclaimer</h3>
          <p>
            <strong>This app is provided "as is" without any warranties. By using this app, you acknowledge that you do so at your own risk. The creator is not responsible for any damages, data compromises, or other issues that may result from using this application.</strong>
          </p>
          <h3>How Your Data is Handled</h3>
          <p>
            This app is a demonstration of what's possible with claude code & the latest Claude models as of December 2025 (sonnet 4.5 and opus 4.5). The code is almost entirely generated by AI. 
          </p>
          <p>
            We aim to:
          </p>
          <ul>
            <li>Make API calls only for (1) LLM generations (Claude API) and (2) some basic usage stats.</li>
            <li>Provide an optinon to bypass our proxy backend entirely by providing your own API key.</li>
            <li>Store all state locally in your browser and on your file system.</li>
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
            <p>SNL Uber Eats Wrapped: <a href="https://youtu.be/Hx7Vv5pqpHg" target="_blank" rel="noopener noreferrer">https://youtu.be/Hx7Vv5pqpHg</a></p>

            <p>
              For better or for worse, every second we spend online is tracked.

              Unfortunately, not all of your services nicely wrap up your year for you. Some even make you pay for it!

              <br /><br />

              The most popular services have dedicated websites built for their specific export format, but there's no guarantee those sites handle your data responsibly or even work with this year's export format. I wanted to make a mostly browser-side, open-source service that would work for <em>any</em> of my data.
            </p>
            <h3>How it works</h3>
            <ol>
              <li>
                Request an export of your data from your trusty <code>{`{MusicStreamingService|FoodDeliveryApp|ShellTerminal|BookReadingSocialMedia|FitnessTracker}`}</code>
              </li>
              <li>
                Wait <code>n</code> hours to receive your data
              </li>
              <li>
                Select the directory with your unzipped, exported data in Yirgachefe.
              </li>
              <li>
                An "exploration" agent tries to understand the shape of your exported data, including what kind of data it is, and who it belongs to. 
              </li>
              <li>
                An "analysis" agent comes up with some interesting insights that highlight your accomplishments, and writes in-browser javascript to extract the insights from the files you provided.
              </li>
              <li>
                A "presentation" agent iterates on an <code>&lt;iframe&gt;</code> based presentation to give you your findings in a fun and lighthearted sequence of screens reminiscent of 2005 era powerpoint. 
              </li>
            </ol>
          </div>
        )}
      </div>

      <main className="app-main">
        {step === 'api-key' && <ApiKeyInput onApiKeySet={handleApiKeySet} />}

        {step === 'directory' && (
          <>
            {hasSavedCodeWriterResult && (
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
              {step === 'exploring' && explorationResult && (
                <button className="secondary-button" onClick={() => handleRetryExploration()}>
                  🔄 Retry Exploration
                </button>
              )}
              {step === 'writing-code' && codeWritingResult && (
                <button className="secondary-button" onClick={() => handleRetryCodeWriting()}>
                  🔄 Retry Code Writing
                </button>
              )}
              {step === 'presenting' && (
                <button className="secondary-button" onClick={() => handleRetryPresentation()}>
                  🔄 Retry Presentation
                </button>
              )}
              {step === 'results' && (
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="secondary-button" onClick={() => handleRetryPresentation()}>
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
                allMessages={allConversationHistory}
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
                  screenshots={screenshots}
                  onContainerReady={(container) => {
                    // Start presentation agent when container is ready
                    if (result) {
                      const guidance = (window as any).__retryPresentationGuidance;
                      delete (window as any).__retryPresentationGuidance;
                      startPresentation(result, container, guidance);
                    }
                  }}
                />
                <AgentProgress
                  events={events}
                  result={displayResult}
                  onStop={handleStop}
                  insights={insights}
                  allMessages={allConversationHistory}
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
                  screenshots={screenshots}
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
                  allMessages={allConversationHistory}
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
          atl |
          &nbsp;<a href="https://github.com/JakeWilliams22/yirgachefe">github |</a>
          &nbsp;<a href="mailto:jakew@duck.com">me</a>
          {sessionId && <span className="session-id"> Session: {sessionId.slice(-8)}</span>}
        </p>
      </footer>
    </div>
  );
}

export default App;
