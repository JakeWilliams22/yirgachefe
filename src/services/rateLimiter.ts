/**
 * Rate limiter for Anthropic API.
 * Tracks token usage and handles 429 responses with retry-after headers.
 * No hard-coded limits - relies on API's retry-after header for rate limiting.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  timestamp: number;
}

export type RateLimitEventType = 'waiting' | 'resumed' | 'usage_update';

export interface RateLimitEvent {
  type: RateLimitEventType;
  waitMs?: number;
  currentUsage?: number;
  limit?: number;
  message?: string;
}

export type RateLimitListener = (event: RateLimitEvent) => void;

export class RateLimiter {
  private usageHistory: TokenUsage[] = [];
  private listeners: RateLimitListener[] = [];
  private windowMs = 60000; // 1 minute window for display tracking

  constructor() {
    // No model-specific config needed - we rely on API's retry-after header
  }

  /**
   * Subscribe to rate limit events.
   */
  on(listener: RateLimitListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: RateLimitEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('Error in rate limit listener:', e);
      }
    }
  }

  /**
   * Get current token usage in the sliding window.
   * Only counts tokens that consume quota (input/output, not cached reads).
   */
  getCurrentUsage(): number {
    this.pruneOldUsage();
    return this.usageHistory.reduce(
      (sum, u) => sum + u.inputTokens + u.outputTokens + (u.cacheCreationTokens || 0),
      0
    );
  }

  /**
   * Get total cached tokens read (doesn't count toward rate limit).
   */
  getCachedTokensRead(): number {
    this.pruneOldUsage();
    return this.usageHistory.reduce(
      (sum, u) => sum + (u.cacheReadTokens || 0),
      0
    );
  }

  /**
   * Remove usage entries older than the window.
   */
  private pruneOldUsage(): void {
    const cutoff = Date.now() - this.windowMs;
    this.usageHistory = this.usageHistory.filter((u) => u.timestamp > cutoff);
  }

  /**
   * Record token usage from a completed request.
   * Includes cache creation and read tokens for accurate tracking.
   */
  recordUsage(
    inputTokens: number,
    outputTokens: number,
    cacheCreationTokens?: number,
    cacheReadTokens?: number
  ): void {
    this.usageHistory.push({
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      timestamp: Date.now(),
    });

    this.emit({
      type: 'usage_update',
      currentUsage: this.getCurrentUsage(),
      limit: 0, // No hard-coded limit - will be determined by API
    });
  }


  /**
   * Handle a 429 rate limit response.
   * Uses retry-after from API response header.
   */
  async handleRateLimitError(retryAfterMs: number): Promise<void> {
    this.emit({
      type: 'waiting',
      waitMs: retryAfterMs,
      currentUsage: this.getCurrentUsage(),
      limit: 0, // No hard-coded limit
      message: `Rate limited by API. Retry after ${Math.ceil(retryAfterMs / 1000)}s...`,
    });

    await this.sleep(retryAfterMs);

    this.emit({
      type: 'resumed',
      message: 'Resuming after rate limit',
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current rate limit status for display.
   */
  getStatus(): {
    currentUsage: number;
    cachedTokensRead: number;
  } {
    return {
      currentUsage: this.getCurrentUsage(),
      cachedTokensRead: this.getCachedTokensRead(),
    };
  }
}
