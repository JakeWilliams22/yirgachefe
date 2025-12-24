/**
 * Component for selecting a directory using the File System Access API.
 */

import { useState } from 'react';
import {
  isFileSystemAccessSupported,
  requestDirectoryAccess,
} from '../services/fileSystem';

interface DirectoryPickerProps {
  onDirectorySelected: (handle: FileSystemDirectoryHandle) => void;
}

export function DirectoryPicker({ onDirectorySelected }: DirectoryPickerProps) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const isSupported = isFileSystemAccessSupported();

  const handleSelectDirectory = async () => {
    setError(null);
    setIsSelecting(true);

    try {
      const handle = await requestDirectoryAccess();
      setSelectedName(handle.name);
      onDirectorySelected(handle);
    } catch (err) {
      const message = (err as Error).message;
      if (!message.includes('cancelled')) {
        setError(message);
      }
    } finally {
      setIsSelecting(false);
    }
  };

  if (!isSupported) {
    return (
      <div className="directory-picker unsupported">
        <h2>Browser Not Supported</h2>
        <p>
          The File System Access API is not supported in your browser. Please use{' '}
          <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> to use
          this application.
        </p>
      </div>
    );
  }

  return (
    <div className="directory-picker">
      <h2>Select Your Data Export Folder</h2>
      <p>
        Choose the folder containing your exported data. We'll explore it, analyze it, and tell you about how great/terrible you were this year.
      </p>

      <button
        className="select-button"
        onClick={handleSelectDirectory}
        disabled={isSelecting}
      >
        {isSelecting ? (
          'Opening folder picker...'
        ) : selectedName ? (
          <>Change Folder (current: {selectedName})</>
        ) : (
          'Select Folder'
        )}
      </button>

      {error && <p className="error">{error}</p>}

      <div className="info-box">
        <h3>What happens next?</h3>
        <ul>
          <li>An AI agent will explore the folder structure</li>
          <li>It will identify data files and understand their format</li>
          <li>You'll see a summary of what data was found</li>
          <li>All processing happens in your browser - your data stays private</li>
        </ul>
      </div>
    </div>
  );
}
