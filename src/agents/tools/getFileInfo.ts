/**
 * Tool for getting file metadata.
 */

import type { Tool, ToolResult } from '../types';
import {
  getFileInfo as fsGetFileInfo,
  formatBytes,
  isLikelyTextFile,
  isLikelyBinaryFile,
} from '../../services/fileSystem';

export interface GetFileInfoInput {
  path: string;
}

export function createGetFileInfoTool(
  rootHandle: FileSystemDirectoryHandle
): Tool {
  return {
    name: 'get_file_info',
    description:
      'Get metadata about a file without reading its contents. Returns file size, type, and last modified date. Useful for understanding file characteristics before deciding whether to read it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file, relative to the root.',
        },
      },
      required: ['path'],
    },
    execute: async (input: unknown): Promise<ToolResult> => {
      const { path } = input as GetFileInfoInput;

      try {
        const info = await fsGetFileInfo(rootHandle, path);

        const isText = isLikelyTextFile(path);
        const isBinary = isLikelyBinaryFile(path);
        const fileCategory = isBinary ? 'binary' : isText ? 'text' : 'unknown';

        const output = [
          `File: ${info.name}`,
          `Path: ${info.path}`,
          `Size: ${formatBytes(info.size)}`,
          `Type: ${info.type}`,
          `Category: ${fileCategory}`,
          `Last Modified: ${info.lastModified.toISOString()}`,
        ].join('\n');

        return {
          success: true,
          output,
          data: { ...info, category: fileCategory },
        };
      } catch (error) {
        return {
          success: false,
          output: `Error getting file info for "${path}": ${(error as Error).message}`,
        };
      }
    },
  };
}
