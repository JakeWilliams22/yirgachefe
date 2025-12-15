/**
 * File System Access API wrapper for browser-based file access.
 * Provides a clean interface for exploring user-selected directories.
 */

export interface FileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  handle: FileSystemHandle;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: Date;
}

export interface FileSystemState {
  rootHandle: FileSystemDirectoryHandle | null;
  rootPath: string;
}

// Check if File System Access API is supported
export function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

/**
 * Request access to a directory from the user.
 * Opens a native folder picker dialog.
 */
export async function requestDirectoryAccess(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error(
      'File System Access API is not supported in this browser. Please use Chrome or Edge.'
    );
  }

  try {
    const handle = await window.showDirectoryPicker({
      mode: 'read',
    });
    return handle;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('Directory selection was cancelled');
    }
    throw error;
  }
}

/**
 * Resolve a path relative to the root handle.
 * Path should be in format: "folder/subfolder/file.txt"
 */
async function resolvePath(
  rootHandle: FileSystemDirectoryHandle,
  path: string
): Promise<FileSystemHandle> {
  if (!path || path === '/' || path === '.') {
    return rootHandle;
  }

  const parts = path.split('/').filter(Boolean);
  let currentHandle: FileSystemHandle = rootHandle;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (currentHandle.kind !== 'directory') {
      throw new Error(`Cannot traverse into file: ${parts.slice(0, i).join('/')}`);
    }

    const dirHandle = currentHandle as FileSystemDirectoryHandle;

    try {
      // Try as directory first
      currentHandle = await dirHandle.getDirectoryHandle(part);
    } catch {
      // If not a directory, try as file (only for last part)
      if (i === parts.length - 1) {
        currentHandle = await dirHandle.getFileHandle(part);
      } else {
        throw new Error(`Path not found: ${path}`);
      }
    }
  }

  return currentHandle;
}

/**
 * List contents of a directory.
 */
export async function listDirectory(
  rootHandle: FileSystemDirectoryHandle,
  path: string = ''
): Promise<FileEntry[]> {
  const handle = await resolvePath(rootHandle, path);

  if (handle.kind !== 'directory') {
    throw new Error(`Not a directory: ${path}`);
  }

  const dirHandle = handle as FileSystemDirectoryHandle;
  const entries: FileEntry[] = [];

  for await (const [name, entryHandle] of dirHandle.entries()) {
    // Skip hidden files/folders (starting with .)
    if (name.startsWith('.')) continue;

    entries.push({
      name,
      path: path ? `${path}/${name}` : name,
      kind: entryHandle.kind,
      handle: entryHandle,
    });
  }

  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return entries;
}

/**
 * Get metadata about a file without reading its contents.
 */
export async function getFileInfo(
  rootHandle: FileSystemDirectoryHandle,
  path: string
): Promise<FileInfo> {
  const handle = await resolvePath(rootHandle, path);

  if (handle.kind !== 'file') {
    throw new Error(`Not a file: ${path}`);
  }

  const fileHandle = handle as FileSystemFileHandle;
  const file = await fileHandle.getFile();

  return {
    name: file.name,
    path,
    size: file.size,
    type: file.type || guessFileType(file.name),
    lastModified: new Date(file.lastModified),
  };
}

/**
 * Read file contents as text.
 * For large files, optionally limit to first N characters.
 */
export async function readFileAsText(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
  options: { maxBytes?: number } = {}
): Promise<string> {
  const handle = await resolvePath(rootHandle, path);

  if (handle.kind !== 'file') {
    throw new Error(`Not a file: ${path}`);
  }

  const fileHandle = handle as FileSystemFileHandle;
  const file = await fileHandle.getFile();

  // For very large files, only read a portion
  if (options.maxBytes && file.size > options.maxBytes) {
    const blob = file.slice(0, options.maxBytes);
    const text = await blob.text();
    return text + `\n\n[... truncated, file is ${formatBytes(file.size)} total]`;
  }

  return file.text();
}

/**
 * Read file as binary (returns ArrayBuffer).
 */
export async function readFileAsBinary(
  rootHandle: FileSystemDirectoryHandle,
  path: string
): Promise<ArrayBuffer> {
  const handle = await resolvePath(rootHandle, path);

  if (handle.kind !== 'file') {
    throw new Error(`Not a file: ${path}`);
  }

  const fileHandle = handle as FileSystemFileHandle;
  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

/**
 * Check if a file is likely a text file based on extension.
 */
export function isLikelyTextFile(filename: string): boolean {
  const textExtensions = new Set([
    '.txt', '.md', '.json', '.csv', '.xml', '.html', '.htm',
    '.css', '.js', '.ts', '.jsx', '.tsx', '.yaml', '.yml',
    '.log', '.ini', '.cfg', '.conf', '.properties',
    '.sh', '.bash', '.zsh', '.fish',
    '.py', '.rb', '.php', '.java', '.c', '.cpp', '.h', '.hpp',
    '.rs', '.go', '.swift', '.kt', '.scala',
    '.sql', '.graphql', '.env', '.gitignore',
  ]);

  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return textExtensions.has(ext);
}

/**
 * Check if a file is likely binary (images, audio, etc).
 */
export function isLikelyBinaryFile(filename: string): boolean {
  const binaryExtensions = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.ico', '.svg',
    '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a',
    '.mp4', '.avi', '.mov', '.mkv', '.webm',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib',
    '.ttf', '.otf', '.woff', '.woff2',
  ]);

  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return binaryExtensions.has(ext);
}

/**
 * Guess file type from filename.
 */
function guessFileType(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();

  const typeMap: Record<string, string> = {
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
  };

  return typeMap[ext] || 'application/octet-stream';
}

/**
 * Format bytes into human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
