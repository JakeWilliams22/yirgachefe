/**
 * Code execution service for safely running generated JavaScript in the browser
 */

import Papa from 'papaparse';
import * as dateFns from 'date-fns';
import _ from 'lodash';
import pako from 'pako';
import FitParser from 'fit-file-parser';
import { readFileAsText, readFileAsBinary } from './fileSystem';

/**
 * Result of code execution
 */
export interface ExecutionResult {
  success: boolean;
  output?: unknown; // Return value from the code
  logs: string[]; // Captured console.log calls
  error?: FormattedError;
  executionTime: number; // Execution time in milliseconds
}

/**
 * Formatted error with line numbers and stack trace
 */
export interface FormattedError {
  message: string;
  type: string;
  line?: number;
  column?: number;
  stack?: string;
}

/**
 * Library bundle exposed to executed code
 */
interface LibraryBundle {
  Papa: typeof Papa;
  dateFns: typeof dateFns;
  _: typeof _;
  pako: typeof pako;
  FitParser: typeof FitParser;
}

/**
 * CodeExecutor provides sandboxed JavaScript execution with file access
 */
export class CodeExecutor {
  private rootHandle: FileSystemDirectoryHandle;
  private libraries: LibraryBundle;

  constructor(rootHandle: FileSystemDirectoryHandle) {
    this.rootHandle = rootHandle;
    this.libraries = {
      Papa,
      dateFns,
      _,
      pako,
      FitParser,
    };
  }

  /**
   * Execute JavaScript code in a sandboxed environment
   */
  async execute(code: string): Promise<ExecutionResult> {
    const logs: string[] = [];
    const startTime = Date.now();

    try {
      // Create captured console for logging
      const capturedConsole = {
        log: (...args: unknown[]) => {
          logs.push(this.formatLogArgs(args));
        },
        error: (...args: unknown[]) => {
          logs.push('ERROR: ' + this.formatLogArgs(args));
        },
        warn: (...args: unknown[]) => {
          logs.push('WARN: ' + this.formatLogArgs(args));
        },
      };

      // Create file reader wrapper that auto-parses based on file type
      const readFile = async (path: string): Promise<unknown> => {
        try {
          const content = await readFileAsText(this.rootHandle, path);

          // Auto-parse based on file extension
          const extension = path.split('.').pop()?.toLowerCase();

          if (extension === 'csv' || extension === 'tsv') {
            const delimiter = extension === 'tsv' ? '\t' : ',';
            const parsed = Papa.parse(content, {
              header: true,
              delimiter,
              skipEmptyLines: true,
              dynamicTyping: true, // Auto-convert numbers
            });

            if (parsed.errors.length > 0) {
              capturedConsole.warn(
                `CSV parsing warnings for ${path}:`,
                parsed.errors.slice(0, 3)
              );
            }

            return parsed.data;
          }

          if (extension === 'json') {
            return JSON.parse(content);
          }

          if (extension === 'jsonl') {
            // Parse JSONL (JSON Lines) format
            return content
              .split('\n')
              .filter((line) => line.trim())
              .map((line) => JSON.parse(line));
          }

          // Return raw text for other file types
          return content;
        } catch (error) {
          throw new Error(
            `Failed to read file '${path}': ${(error as Error).message}`
          );
        }
      };

      // Create binary file reader for compressed/binary formats
      const readFileBinary = async (path: string): Promise<Uint8Array> => {
        try {
          const arrayBuffer = await readFileAsBinary(this.rootHandle, path);
          return new Uint8Array(arrayBuffer);
        } catch (error) {
          throw new Error(
            `Failed to read binary file '${path}': ${(error as Error).message}`
          );
        }
      };

      // Create execution context with controlled APIs
      const now = new Date();
      const context = {
        Papa: this.libraries.Papa,
        dateFns: this.libraries.dateFns,
        _: this.libraries._,
        pako: this.libraries.pako,
        FitParser: this.libraries.FitParser,
        readFile,
        readFileBinary,
        console: capturedConsole,
        // Date/time information for year-in-review context
        currentDate: now,
        currentYear: now.getFullYear(),
        currentMonth: now.getMonth() + 1, // 1-12
        today: now.toISOString().split('T')[0], // YYYY-MM-DD
      };

      // Create async function with controlled context
      // We use AsyncFunction constructor to create an isolated function
      const AsyncFunction = async function () {}.constructor as FunctionConstructor;

      // Extract context keys and values
      const contextKeys = Object.keys(context);
      const contextValues = Object.values(context);

      // Create the function with the code
      // The function signature is: async function(Papa, dateFns, _, readFile, console) { code }
      const fn = AsyncFunction(...contextKeys, code) as (
        ...args: unknown[]
      ) => Promise<unknown>;

      // Execute with timeout
      const result = await this.executeWithTimeout(
        fn(...contextValues),
        30000 // 30 second timeout
      );

      return {
        success: true,
        output: result,
        logs,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        logs,
        error: this.formatError(error as Error, code),
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute a promise with a timeout
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Execution timeout after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }

  /**
   * Format console.log arguments to a string
   */
  private formatLogArgs(args: unknown[]): string {
    return args
      .map((arg) => {
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ');
  }

  /**
   * Format an error with line numbers and stack trace
   */
  private formatError(error: Error, code: string): FormattedError {
    const formatted: FormattedError = {
      message: error.message,
      type: error.name || 'Error',
    };

    // Try to extract line and column numbers from stack trace
    if (error.stack) {
      formatted.stack = error.stack;

      // Try to parse line/column from various error formats
      // Format: "at <anonymous>:LINE:COLUMN"
      const match =
        error.stack.match(/<anonymous>:(\d+):(\d+)/) ||
        error.stack.match(/at line (\d+):(\d+)/) ||
        error.stack.match(/:(\d+):(\d+)/);

      if (match) {
        formatted.line = parseInt(match[1], 10);
        formatted.column = parseInt(match[2], 10);

        // Add context: show the problematic line
        if (formatted.line) {
          const lines = code.split('\n');
          const errorLine = lines[formatted.line - 1];
          if (errorLine) {
            formatted.message += `\n\nLine ${formatted.line}: ${errorLine.trim()}`;
          }
        }
      }
    }

    return formatted;
  }

  /**
   * Validate that code doesn't contain dangerous patterns
   * This is a basic safety check - the AsyncFunction sandbox is the main security
   */
  static validateCode(code: string): { valid: boolean; reason?: string } {
    // Check for obviously dangerous patterns
    const dangerousPatterns = [
      /import\s+/i, // No imports (we provide libraries)
      /require\s*\(/i, // No require
      /eval\s*\(/i, // No eval
      /Function\s*\(/i, // No Function constructor
      /\.constructor/i, // No constructor access
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return {
          valid: false,
          reason: `Code contains potentially dangerous pattern: ${pattern.source}`,
        };
      }
    }

    return { valid: true };
  }
}
