/**
 * Component for entering and validating the Anthropic API key.
 */

import { useState } from 'react';
import { AnthropicClient } from '../services/anthropic';

interface ApiKeyInputProps {
  onApiKeySet: (apiKey: string) => void;
}

export function ApiKeyInput({ onApiKeySet }: ApiKeyInputProps) {
  const [apiKey, setApiKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <h2>Enter your Anthropic API Key</h2>
      <p className="privacy-note">
        Your API key stays in your browser and is never sent to any server except
        Anthropic's API. All data processing happens locally.
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
    </div>
  );
}
