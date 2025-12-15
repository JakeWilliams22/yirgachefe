/**
 * Logger service for writing execution logs to a local file
 */

import type { AgentEvent } from '../agents/types';

export class Logger {
  private rootHandle: FileSystemDirectoryHandle;
  private logFileName: string;
  private logEntries: string[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;

  constructor(rootHandle: FileSystemDirectoryHandle, sessionId: string) {
    this.rootHandle = rootHandle;
    this.logFileName = `yirgachefe-log-${sessionId}.txt`;
  }

  /**
   * Log an agent event
   */
  logEvent(phase: 'exploration' | 'code-writing', event: AgentEvent): void {
    const timestamp = new Date().toISOString();
    const lines: string[] = [];

    lines.push(`[${timestamp}] [${phase.toUpperCase()}]`);

    switch (event.type) {
      case 'status_change':
        lines.push(`STATUS: ${event.status}${event.message ? ` - ${event.message}` : ''}`);
        break;

      case 'thinking':
        lines.push(`THINKING: ${event.text.substring(0, 200)}${event.text.length > 200 ? '...' : ''}`);
        break;

      case 'tool_call':
        lines.push(`TOOL CALL: ${event.toolName}`);
        lines.push(`Input: ${JSON.stringify(event.input)}`);
        break;

      case 'tool_result':
        lines.push(`TOOL RESULT: ${event.toolName}`);
        lines.push(`Success: ${event.result.success}`);
        lines.push(`Output: ${event.result.output.substring(0, 500)}${event.result.output.length > 500 ? '...' : ''}`);
        break;

      case 'discovery':
        lines.push(`DISCOVERY: ${event.discovery.type} - ${event.discovery.description}`);
        if (event.discovery.path) {
          lines.push(`Path: ${event.discovery.path}`);
        }
        break;

      case 'error':
        lines.push(`ERROR: ${event.error}`);
        break;

      case 'complete':
        lines.push(`COMPLETE: ${event.result.success ? 'SUCCESS' : 'FAILED'}`);
        lines.push(`Summary: ${event.result.summary}`);
        lines.push(`Discoveries: ${event.result.discoveries.length}`);
        lines.push(`Tokens: ${event.result.tokenUsage.input} in / ${event.result.tokenUsage.output} out`);
        break;

      case 'rate_limit':
        if (event.waiting) {
          lines.push(`RATE LIMIT: Waiting ${event.waitMs}ms - ${event.message || ''}`);
        }
        if (event.usage) {
          lines.push(`Token usage: ${event.usage.utilizationPercent}% (${event.usage.currentUsage}/${event.usage.limit})`);
        }
        break;

      case 'message':
        lines.push(`MESSAGE [${event.role}]: ${typeof event.content === 'string' ? event.content.substring(0, 200) : '[complex content]'}`);
        break;
    }

    lines.push(''); // Empty line separator

    this.logEntries.push(lines.join('\n'));
    this.scheduleFlush();
  }

  /**
   * Log a custom message
   */
  log(phase: 'exploration' | 'code-writing' | 'system', message: string): void {
    const timestamp = new Date().toISOString();
    this.logEntries.push(`[${timestamp}] [${phase.toUpperCase()}] ${message}\n`);
    this.scheduleFlush();
  }

  /**
   * Schedule a flush to disk (debounced)
   */
  private scheduleFlush(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }

    // Flush after 2 seconds of inactivity, or immediately if we have >50 entries
    if (this.logEntries.length > 50) {
      this.flush();
    } else {
      this.flushTimeout = setTimeout(() => this.flush(), 2000);
    }
  }

  /**
   * Write all pending log entries to file
   */
  async flush(): Promise<void> {
    if (this.logEntries.length === 0) return;

    try {
      // Get or create log file
      const fileHandle = await this.rootHandle.getFileHandle(this.logFileName, { create: true });

      // Read existing content
      const file = await fileHandle.getFile();
      const existingContent = await file.text();

      // Append new entries
      const newContent = existingContent + this.logEntries.join('');

      // Write back to file
      const writable = await fileHandle.createWritable();
      await writable.write(newContent);
      await writable.close();

      // Clear flushed entries
      this.logEntries = [];

      if (this.flushTimeout) {
        clearTimeout(this.flushTimeout);
        this.flushTimeout = null;
      }
    } catch (error) {
      console.error('Failed to write log file:', error);
      // Keep entries in memory if write fails
    }
  }

  /**
   * Force immediate flush
   */
  async forceFlush(): Promise<void> {
    await this.flush();
  }
}
