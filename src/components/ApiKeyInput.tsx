/**
 * Component for entering and validating the Anthropic API key.
 */

import { useState } from 'react';
import { AnthropicClient, PROXY_MODE_KEY } from '../services/anthropic';

interface ApiKeyInputProps {
  onApiKeySet: (apiKey: string) => void;
}

export function ApiKeyInput({ onApiKeySet }: ApiKeyInputProps) {
  const [apiKey, setApiKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);

  const handleTryDemo = async () => {
    setIsValidating(true);
    setError(null);

    try {
      // Check proxy quota status (fast, free check)
      const statusResponse = await fetch('/api/proxy', {
        method: 'GET',
      });

      if (!statusResponse.ok) {
        throw new Error('Failed to check demo quota status');
      }

      const status = await statusResponse.json();

      if (!status.available) {
        setError('Demo quota is currently exhausted. Please use your own API key.');
        setShowApiKeyForm(true);
        return;
      }

      // Quota available, set proxy mode
      onApiKeySet(PROXY_MODE_KEY);
    } catch (err: any) {
      setError(`Demo quota unavailable: ${err?.message || 'Unknown error'}. Please use your own API key.`);
      setShowApiKeyForm(true);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    if (!apiKey.startsWith('sk-ant-')) {
      setError('API key should start with "sk-ant-"');
      return;
    }

    setIsValidating(true);

    try {
      const client = new AnthropicClient(apiKey.trim());
      const isValid = await client.validateApiKey();

      if (isValid) {
        onApiKeySet(apiKey.trim());
      } else {
        setError('Invalid API key. Please check and try again.');
      }
    } catch (err) {
      setError(`Validation failed: ${(err as Error).message}`);
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="api-key-input">
      <h2>Get Started</h2>

      {!showApiKeyForm ? (
        <>
          <p className="privacy-note">
            Try the app with our demo quota, or bring your own Anthropic API key for unlimited usage.
          </p>

          <div className="button-group" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '2rem' }}>
            <button
              className="primary-button"
              onClick={handleTryDemo}
              disabled={isValidating}
              style={{ padding: '1rem 2rem', fontSize: '1rem' }}
            >
              {isValidating ? 'Checking availability...' : '✨ Try with Demo Quota'}
            </button>

            <button
              className="secondary-button"
              onClick={() => setShowApiKeyForm(true)}
              disabled={isValidating}
              style={{ padding: '1rem 2rem', fontSize: '1rem' }}
            >
              🔑 Use Your Own API Key
            </button>
          </div>

          {error && <p className="error" style={{ marginTop: '1rem' }}>{error}</p>}

          <p className="help-text" style={{ marginTop: '2rem' }}>
            Demo quota is limited and shared. For best experience, use your own API key (~$2 per run).
          </p>
        </>
      ) : (
        <>
          <p className="privacy-note">
            Your API key is stored locally in your browser and is only sent to Anthropic. No other servers. Code executes locally in your browser. Typical cost: ~$2 per run.
          </p>

          <form onSubmit={handleSubmit}>
            <div className="input-group">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-api..."
                disabled={isValidating}
                autoComplete="off"
              />
              <button type="submit" disabled={isValidating || !apiKey.trim()}>
                {isValidating ? 'Validating...' : 'Continue'}
              </button>
            </div>

            {error && <p className="error">{error}</p>}
          </form>

          <button
            className="text-button"
            onClick={() => {
              setShowApiKeyForm(false);
              setError(null);
              setApiKey('');
            }}
            style={{ marginTop: '1rem', textDecoration: 'underline' }}
          >
            ← Back to options
          </button>

          <p className="help-text">
            Don't have an API key?{' '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
            >
              Get one from Anthropic Console
            </a>
          </p>
        </>
      )}
    </div>
  );
}
