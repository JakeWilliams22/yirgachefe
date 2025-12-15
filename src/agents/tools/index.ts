/**
 * Tool registry and factory functions.
 */

import type { Tool } from '../types';
import { createListDirectoryTool } from './listDirectory';
import { createSmartReadFileTool, createReadFileTool } from './readFile';
import { createGetFileInfoTool } from './getFileInfo';
import { createExecuteCodeTool } from './executeCode';

export { createListDirectoryTool } from './listDirectory';
export { createReadFileTool, createSmartReadFileTool } from './readFile';
export { createGetFileInfoTool } from './getFileInfo';
export { createExecuteCodeTool } from './executeCode';

/**
 * Create all file system exploration tools.
 * Uses smart read tool that adapts to file types.
 */
export function createFileSystemTools(
  rootHandle: FileSystemDirectoryHandle
): Tool[] {
  return [
    createListDirectoryTool(rootHandle),
    createSmartReadFileTool(rootHandle), // Smart version adapts to file type
    createGetFileInfoTool(rootHandle),
  ];
}

/**
 * Create tools for the code-writing agent.
 * Includes file reading (full content) and code execution.
 */
export function createCodeWriterTools(
  rootHandle: FileSystemDirectoryHandle
): Tool[] {
  return [
    createReadFileTool(rootHandle), // Regular read tool for full file content
    createExecuteCodeTool(rootHandle),
  ];
}
