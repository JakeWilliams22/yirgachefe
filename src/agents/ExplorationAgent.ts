/**
 * Exploration Agent - Systematically explores a directory to understand its data structure.
 * Uses BFS-style traversal to discover files, data types, and relationships.
 * Supports checkpointing and resuming for crash recovery.
 */

import { AnthropicClient } from '../services/anthropic';
import { AgentRunner, type CheckpointData } from './AgentRunner';
import { createFileSystemTools } from './tools';
import type { AgentConfig, AgentResult, AgentEventListener } from './types';

const EXPLORATION_SYSTEM_PROMPT = `You are a Data Exploration Agent. Your job is to systematically explore a directory containing exported user data (like a Spotify data export, Strava export, etc.) and understand its structure.

**IMPORTANT CONTEXT**: It is currently December 2025/January 2026. We're creating a "2025 Year in Review", so pay attention to date fields and time-based data that covers 2025.

**IMPORTANT**: You are conducting this research FOR A CODE-WRITING AGENT that will use your findings to write data analysis code. Your discoveries must include precise, actionable file format information that enables programmatic data access.

## Your Goals

1. **Discover the overall structure**: Map out directories and their purposes
2. **Identify data files**: Find files containing user data (JSON, CSV, etc.)
3. **Understand data schemas**: Sample files to understand their structure and content WITH SPECIFIC FORMAT DETAILS
4. **Find relationships**: Identify how different data files relate to each other
5. **Identify time-based data**: Look for data that could be used for "Year in Review" analysis

## Exploration Strategy

Use a breadth-first approach:
1. Start by listing the root directory to understand top-level structure
2. Explore each subdirectory systematically
3. For each interesting file you find:
   - Check its info (size, type) first
   - If it's a text/JSON/CSV file, read a sample to understand the structure
   - **CRITICALLY IMPORTANT**: Document the file format details:
     * **File type**: CSV, JSON, TSV, etc.
     * **For CSV/TSV files**: List ALL column headers/field names in order
     * **For JSON files**: Describe the structure (object vs array, key names, nesting)
     * **Data types**: What type of data each field contains (string, number, timestamp, etc.)
     * **Field formats**: Date/time formats, ID formats, any special encoding

## What to Look For

- **Streaming/listening history**: Timestamps of activities
- **User preferences**: Settings, saved items, favorites
- **Social data**: Followers, follows, messages
- **Activity data**: Workouts, locations, events
- **Media data**: Playlists, libraries, collections
- **Metadata**: Account info, export info

## Output Format

As you explore, describe what you find WITH PRECISE FORMAT DETAILS. When you're done, provide a comprehensive summary including:

1. **Directory Structure**: Overview of how files are organized
2. **Key Data Files**: List with:
   - File path
   - File type (CSV, JSON, etc.)
   - Column headers (for CSV) OR structure (for JSON)
   - Field descriptions and data types
   - Example values where helpful
3. **Data Types Found**: Types of user data present
4. **Schema Examples**: Sample structures from key files with ALL field names
5. **Year in Review Potential**: What data could be used for interesting statistics/visualizations

## Important Notes

- Skip binary files (images, audio) - just note their presence
- For very large files, read just a sample to understand the structure
- Don't read every file - focus on understanding the overall picture
- If you see common patterns (like dated folders), note the pattern and sample one
- **ALWAYS document column headers for CSV files - the code writer needs these!**
- **ALWAYS document JSON structure and key names - the code writer needs these!**

Begin exploring now!`;

export interface ExplorationAgentOptions {
  rootHandle: FileSystemDirectoryHandle;
  apiKey: string;
  model?: string;
  maxIterations?: number;
  /** Callback when checkpoint is saved */
  onCheckpoint?: (data: CheckpointData) => void;
  /** Checkpoint to resume from */
  resumeFrom?: CheckpointData;
}

export interface ExplorationAgent {
  run: () => Promise<AgentResult>;
  stop: () => void;
  on: (listener: AgentEventListener) => () => void;
}

/**
 * Create an exploration agent for the given directory.
 */
export function createExplorationAgent(
  options: ExplorationAgentOptions
): ExplorationAgent {
  const {
    rootHandle,
    apiKey,
    model,
    maxIterations = 30,
    onCheckpoint,
    resumeFrom,
  } = options;

  const client = new AnthropicClient(apiKey, model);
  const tools = createFileSystemTools(rootHandle);

  const config: AgentConfig = {
    name: 'ExplorationAgent',
    description: 'Explores a directory to understand its data structure',
    systemPrompt: EXPLORATION_SYSTEM_PROMPT,
    tools,
    maxIterations,
  };

  const runner = new AgentRunner(config, client, {
    onCheckpoint,
    checkpointInterval: 2, // Checkpoint every 2 iterations for exploration
  });

  return {
    run: () => {
      if (resumeFrom) {
        return runner.resume(resumeFrom);
      }
      return runner.run(
        'Please explore this directory and help me understand what data is available. I want to create a "Year in Review" summary from this exported data.'
      );
    },
    stop: () => runner.stop(),
    on: (listener) => runner.on(listener),
  };
}

/**
 * Parse the exploration result to extract structured findings.
 */
export interface ExplorationFindings {
  directories: string[];
  dataFiles: Array<{
    path: string;
    type: string;
    description: string;
  }>;
  dataTypes: string[];
  schemas: Record<string, unknown>;
  yearInReviewPotential: string[];
}

export function parseExplorationResult(result: AgentResult): ExplorationFindings {
  // Extract information from discoveries
  const directories = result.discoveries
    .filter((d) => d.type === 'directory')
    .map((d) => d.path || d.description);

  const dataFiles = result.discoveries
    .filter((d) => d.type === 'file' || d.type === 'data_type')
    .map((d) => ({
      path: d.path || '',
      type: d.metadata?.type as string || 'unknown',
      description: d.description,
    }));

  const dataTypes = [
    ...new Set(
      result.discoveries
        .filter((d) => d.type === 'data_type')
        .map((d) => d.metadata?.type as string)
        .filter(Boolean)
    ),
  ];

  // Extract schemas from metadata
  const schemas: Record<string, unknown> = {};
  for (const d of result.discoveries) {
    if (d.type === 'data_type' && d.path && d.metadata) {
      schemas[d.path] = d.metadata;
    }
  }

  // Year in review potential would be extracted from the LLM's summary
  // For now, return empty - could parse the summary with regex or another LLM call
  const yearInReviewPotential: string[] = [];

  return {
    directories,
    dataFiles,
    dataTypes,
    schemas,
    yearInReviewPotential,
  };
}
