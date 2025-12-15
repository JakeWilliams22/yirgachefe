/**
 * Tool for reading file contents with smart sampling.
 * Defaults to reading only first N lines to conserve tokens.
 */

import type { Tool, ToolResult } from '../types';
import {
  readFileAsText,
  isLikelyBinaryFile,
  getFileInfo,
  formatBytes,
} from '../../services/fileSystem';

export interface ReadFileInput {
  path: string;
  /** Number of lines to read from start. Default: 30 */
  lines?: number;
  /** Read entire file (use sparingly). Default: false */
  fullFile?: boolean;
  /** Read from end of file instead of start. Default: false */
  fromEnd?: boolean;
}

// Default lines to read - enough to understand structure
const DEFAULT_LINES = 30;

// Maximum lines allowed in a single read
const MAX_LINES = 500;

// Maximum file size to read entirely (50KB)
const MAX_FULL_FILE_SIZE = 50 * 1024;

export function createReadFileTool(
  rootHandle: FileSystemDirectoryHandle
): Tool {
  return {
    name: 'read_file',
    description: `Read contents of a text file with automatic format detection. By default reads first 30 lines to understand structure.

IMPORTANT: This tool automatically extracts and reports:
- File type (CSV, JSON, TSV, etc.)
- Column headers for CSV/TSV files (critical for code writing!)
- JSON structure and key names (critical for code writing!)
- Delimiter used in delimited files

Options:
- lines: Number of lines to read (default: 30, max: 500)
- fullFile: Read entire file if small enough (<50KB)
- fromEnd: Read last N lines instead of first N

For JSON files, 30 lines usually shows the schema. For CSVs, shows header + sample rows.
Binary files cannot be read - use get_file_info instead.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read, relative to the root.',
        },
        lines: {
          type: 'number',
          description: 'Number of lines to read. Default: 30, max: 500.',
        },
        fullFile: {
          type: 'boolean',
          description: 'Read entire file if under 50KB. Use sparingly.',
        },
        fromEnd: {
          type: 'boolean',
          description: 'Read from end of file instead of start.',
        },
      },
      required: ['path'],
    },
    execute: async (input: unknown): Promise<ToolResult> => {
      const { path, lines, fullFile, fromEnd } = input as ReadFileInput;

      try {
        // Check if it's a binary file
        if (isLikelyBinaryFile(path)) {
          const info = await getFileInfo(rootHandle, path);
          return {
            success: true,
            output: `Cannot read binary file "${path}" (${info.type}, ${formatBytes(info.size)}). Use get_file_info for metadata.`,
            data: { isBinary: true, info },
          };
        }

        // Get file info first
        const info = await getFileInfo(rootHandle, path);

        // Determine read strategy
        const readFullFile = fullFile && info.size <= MAX_FULL_FILE_SIZE;
        const lineCount = Math.min(lines || DEFAULT_LINES, MAX_LINES);

        // Read the file content
        const fullContent = await readFileAsText(rootHandle, path, {
          // Only limit bytes if not reading full file
          maxBytes: readFullFile ? undefined : lineCount * 200, // ~200 chars per line estimate
        });

        let output: string;
        let linesRead: number;
        let truncated = false;

        // Split into lines for format extraction
        const allLines = fullContent.split('\n');

        if (readFullFile) {
          // Return full content
          output = fullContent;
          linesRead = allLines.length;
        } else {
          // Take requested amount
          const totalLines = allLines.length;

          let selectedLines: string[];
          if (fromEnd) {
            selectedLines = allLines.slice(-lineCount);
          } else {
            selectedLines = allLines.slice(0, lineCount);
          }

          linesRead = selectedLines.length;
          truncated = totalLines > lineCount;
          output = selectedLines.join('\n');

          // Add truncation notice
          if (truncated) {
            const remaining = totalLines - lineCount;
            const position = fromEnd ? 'first' : 'remaining';
            output += `\n\n[... ${remaining} ${position} lines not shown. File has ${totalLines} total lines.]`;
          }
        }

        // Extract format information for code writer
        const formatInfo = extractFormatInfo(path, output, allLines);

        // Build result header with format information
        const headerParts = [
          `File: ${path}`,
          `Type: ${formatInfo.fileType}`,
          `Size: ${formatBytes(info.size)}`,
          `Lines shown: ${linesRead}${truncated ? ` (of ~${Math.ceil(info.size / 50)})` : ''}`,
          fromEnd ? '(reading from end)' : '',
        ];

        if (formatInfo.columns && formatInfo.columns.length > 0) {
          headerParts.push(`Columns (${formatInfo.columns.length}): ${formatInfo.columns.join(', ')}`);
        }

        if (formatInfo.jsonStructure) {
          headerParts.push(`JSON Structure: ${formatInfo.jsonStructure}`);
        }

        const header = headerParts.filter(Boolean).join(' | ');

        return {
          success: true,
          output: `${header}\n${'─'.repeat(60)}\n${output}`,
          data: {
            content: output,
            info,
            linesRead,
            truncated,
            fromEnd: fromEnd || false,
            format: formatInfo,
          },
        };
      } catch (error) {
        return {
          success: false,
          output: `Error reading file "${path}": ${(error as Error).message}`,
        };
      }
    },
  };
}

/**
 * Extract format information from file content for code writers.
 */
interface FormatInfo {
  fileType: string;
  columns?: string[];
  jsonStructure?: string;
  delimiter?: string;
}

function extractFormatInfo(path: string, content: string, allLines: string[]): FormatInfo {
  const ext = path.toLowerCase().split('.').pop() || '';
  const info: FormatInfo = { fileType: ext.toUpperCase() };

  // CSV/TSV files - extract column headers
  if (ext === 'csv' || ext === 'tsv') {
    const delimiter = ext === 'tsv' ? '\t' : ',';
    info.delimiter = delimiter;

    if (allLines.length > 0) {
      const headerLine = allLines[0];
      // Parse CSV header, handling quoted fields
      info.columns = parseCSVLine(headerLine, delimiter);
      info.fileType = `${ext.toUpperCase()} (${info.columns.length} columns)`;
    }
  }

  // JSON files - describe structure
  if (ext === 'json' || ext === 'jsonl') {
    try {
      const trimmed = content.trim();
      const parsed = JSON.parse(trimmed);

      if (Array.isArray(parsed)) {
        if (parsed.length > 0 && typeof parsed[0] === 'object') {
          const keys = Object.keys(parsed[0]);
          info.jsonStructure = `Array of ${parsed.length} objects`;
          info.columns = keys; // For arrays of objects, treat keys as columns
        } else {
          info.jsonStructure = `Array of ${parsed.length} items`;
        }
      } else if (typeof parsed === 'object' && parsed !== null) {
        const keys = Object.keys(parsed);
        info.jsonStructure = `Object with keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`;
        info.columns = keys;
      }
    } catch {
      // Not valid JSON or incomplete
      info.jsonStructure = 'Invalid or incomplete JSON';
    }
  }

  return info;
}

/**
 * Parse a CSV line, handling quoted fields.
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Helper to create a smarter read tool that adapts to file type.
 * For JSON: reads enough to show schema
 * For CSV: reads header + sample rows
 * For logs: reads from end by default
 */
export function createSmartReadFileTool(
  rootHandle: FileSystemDirectoryHandle
): Tool {
  const baseTool = createReadFileTool(rootHandle);

  return {
    ...baseTool,
    name: 'read_file',
    execute: async (input: unknown): Promise<ToolResult> => {
      const { path, lines, fullFile, fromEnd } = input as ReadFileInput;

      // Smart defaults based on file extension
      const ext = path.toLowerCase().split('.').pop() || '';
      let smartLines = lines || DEFAULT_LINES;
      let smartFromEnd = fromEnd || false;

      // Adjust based on file type
      switch (ext) {
        case 'json':
          // JSON files: read more to capture nested structure
          smartLines = lines || 50;
          break;
        case 'csv':
        case 'tsv':
          // CSV: header + enough rows to see data patterns
          smartLines = lines || 20;
          break;
        case 'log':
          // Log files: read from end by default
          smartFromEnd = fromEnd ?? true;
          smartLines = lines || 50;
          break;
        case 'md':
        case 'txt':
          // Text files: reasonable amount
          smartLines = lines || 40;
          break;
      }

      return baseTool.execute({
        path,
        lines: smartLines,
        fullFile,
        fromEnd: smartFromEnd,
      });
    },
  };
}
