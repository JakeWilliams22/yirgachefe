/**
 * Tool for listing directory contents.
 */

import type { Tool, ToolResult } from '../types';
import { listDirectory as fsListDirectory, type FileEntry } from '../../services/fileSystem';

export interface ListDirectoryInput {
  path: string;
}

export function createListDirectoryTool(
  rootHandle: FileSystemDirectoryHandle
): Tool {
  return {
    name: 'list_directory',
    description:
      'List the contents of a directory. Returns a list of files and subdirectories with their types. Use this to explore the file structure.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Path to the directory to list, relative to the root. Use empty string or "/" for root directory.',
        },
      },
      required: ['path'],
    },
    execute: async (input: unknown): Promise<ToolResult> => {
      const { path } = input as ListDirectoryInput;

      try {
        const entries = await fsListDirectory(rootHandle, path || '');

        const formatted = formatEntries(entries);

        return {
          success: true,
          output: formatted,
          data: entries,
        };
      } catch (error) {
        return {
          success: false,
          output: `Error listing directory "${path}": ${(error as Error).message}`,
        };
      }
    },
  };
}

function formatEntries(entries: FileEntry[]): string {
  if (entries.length === 0) {
    return 'Directory is empty.';
  }

  const lines = entries.map((entry) => {
    const icon = entry.kind === 'directory' ? '📁' : '📄';
    return `${icon} ${entry.name}${entry.kind === 'directory' ? '/' : ''}`;
  });

  return `Found ${entries.length} items:\n${lines.join('\n')}`;
}
