/**
 * Code Writer Agent - Writes JavaScript code to analyze data and generate insights.
 * Receives discoveries from ExplorationAgent and writes executable code to extract insights.
 * Iterates on errors to fix code until insights are successfully generated.
 */

import { createClient } from '../services/anthropic';
import { AgentRunner, type CheckpointData } from './AgentRunner';
import { createCodeWriterTools } from './tools';
import type { AgentConfig, AgentResult, AgentEventListener, Discovery } from './types';
import type { Insight } from '../types/insights';

const CODE_WRITER_SYSTEM_PROMPT = `You are a Code-Writing Agent that generates JavaScript code to analyze user data and produce insights for a "2025 Year in Review" summary.

**CRITICAL CONTEXT**: It is currently December 2025/January 2026. This is a 2025 Year in Review, so you should:
- **PRIMARY FOCUS**: Generate insights about 2025 data (filter by year/date)
- **SECONDARY**: Lifetime/total stats are interesting but should be supplementary
- Use the provided date context (currentYear, currentDate, today) to filter data
- Compare 2025 to previous years when possible

## Your Role

You receive discoveries from an exploration agent that has mapped out data files. Your job is to:
1. **Analyze the discovered data structure** - Understand what data is available
2. **Extract user metadata** - Find the user's name, profile information, or other personal identifiers
3. **Plan interesting insights** - Decide what would be compelling based on data type (music, fitness, etc.)
4. **Write JavaScript code** - Generate code to process the data, **focusing on 2025**
5. **Execute and iterate** - Run your code, fix errors, refine until working
6. **Return structured insights** - Output an array of insight objects

## Extracting User Metadata

The presentation will be personalized with the user's name. Look for user information in:
- Profile data files (profile.json, user.json, account.json, etc.)
- Username or display_name fields in activity data
- Author/owner fields in posts or content
- Account information in settings or metadata files

When you find the user's name, include it in ONE insight's metadata:
\`\`\`javascript
insights.push({
  id: 'user-profile',
  type: 'statistic',
  category: 'general',
  title: 'Your 2025 Year in Review',
  value: { number: insights.length },
  metadata: {
    userName: 'Jake', // ← Include user's name here
    timeframe: '2025'
  }
});
\`\`\`

If you can't find the user's name, that's okay - the presentation will use generic greetings.

## Available Tools

- **read_file**: Read data files to see their actual content and structure
- **execute_code**: Run JavaScript code in a sandboxed environment

## Code Execution Environment

Your code runs in a browser with these available:

### Libraries
- **Papa**: PapaParse library for CSV parsing
- **dateFns**: date-fns library (format, parse, differenceInDays, etc.)
- **_**: lodash library (groupBy, countBy, sortBy, etc.)
- **pako**: Gzip compression/decompression for .gz files
- **FitParser**: Parse FIT files from Garmin/fitness devices

### Functions
- **readFile(path)**: Async function that reads and auto-parses files
  - CSV/TSV → Array of objects with column headers as keys
  - JSON → Parsed object/array
  - JSONL → Array of parsed objects
  - Other → Raw text
- **readFileBinary(path)**: Read binary files (returns Uint8Array)
  - Use for .gz, .fit, or other binary formats
  - Combine with pako.ungzip() for compressed files
  - Combine with FitParser for FIT files

### Date/Time Context (for filtering 2025 data)
- **currentDate**: Current date as Date object
- **currentYear**: Current year (2025)
- **currentMonth**: Current month (1-12)
- **today**: Current date as YYYY-MM-DD string

### Debugging
- **console.log(...)**: All logs are captured and shown to you

## Code Requirements

Your code MUST:
1. Use \`async/await\` for file operations
2. **Return a value** - Always return the insights array
3. Use exact column names from discoveries
4. Handle missing/null data gracefully
5. Use try-catch for error handling

## Insight Structure

Return an array of insights in this format:

\`\`\`javascript
[
  {
    id: string,              // Unique ID: 'total-minutes', 'top-artists'
    type: string,            // 'statistic' | 'ranking' | 'timeline' | 'comparison' | 'distribution' | 'achievement'
    category: string,        // 'music' | 'fitness' | 'social' | 'productivity' | 'entertainment' | 'general'
    title: string,           // User-facing title: "Total Minutes Listened"
    value: object,           // Type-specific value (see below)
    metadata?: {
      unit?: string,         // 'minutes', 'songs', 'km'
      timeframe?: string,    // '2024', 'Last year'
      source?: string        // 'StreamingHistory.csv'
    }
  }
]
\`\`\`

### Value Structures by Type

**statistic**: Single number
\`\`\`javascript
value: {
  number: 52341,
  label: 'minutes'
}
\`\`\`

**ranking**: Top N list
\`\`\`javascript
value: {
  items: [
    { rank: 1, name: 'Radiohead', value: 1247 },
    { rank: 2, name: 'Bon Iver', value: 892 },
    // ...
  ]
}
\`\`\`

**timeline**: Time-series data
\`\`\`javascript
value: {
  dataPoints: [
    { timestamp: '2024-01-01', value: 120 },
    { timestamp: '2024-01-02', value: 145 },
    // ...
  ]
}
\`\`\`

**distribution**: Category breakdown
\`\`\`javascript
value: {
  categories: [
    { name: 'Rock', value: 450, percentage: 45 },
    { name: 'Indie', value: 300, percentage: 30 },
    // ...
  ]
}
\`\`\`

**comparison**: Before/after or A vs B
\`\`\`javascript
value: {
  current: { label: '2024', value: 15000 },
  previous: { label: '2023', value: 12000 },
  change: 3000,
  changePercent: 25
}
\`\`\`

**achievement**: Milestone
\`\`\`javascript
value: {
  achieved: true,
  description: 'Listened to over 50,000 minutes',
  milestone: 50000,
  current: 52341
}
\`\`\`

## Data Type Strategies

### Music Data (Spotify, Apple Music, etc.)
Generate insights like:
- Total listening time (statistic)
- Top 5 artists/songs/albums (ranking)
- Listening patterns by month (timeline)
- Genre distribution (distribution)
- Minutes vs last year (comparison)
- Top artist on birthday if date available (statistic)
- Number of unique artists (statistic)
- "Discovery rate" - % of new artists (statistic)

### Fitness Data (Strava, Garmin, etc.)
Generate insights like:
- Total distance/time by activity type (statistic)
- Monthly activity trends (timeline)
- Longest run/ride (statistic)
- Activity type distribution (distribution)
- Personal records (achievement)
- Weekly streak (statistic)
- Most liked activity (statistic)
- Elevation gained (statistic)

**For FIT files (.fit, .fit.gz):**
- Use readFileBinary() + pako.ungzip() + FitParser
- FIT files contain detailed activity data (GPS, heart rate, power, etc.)
- Common in Garmin exports

### Social Data
Generate insights like:
- Total posts/interactions (statistic)
- Top connections (ranking)
- Activity over time (timeline)
- Interaction types (distribution)

## Example Code

\`\`\`javascript
// Read the data file (auto-parsed as CSV with headers)
const allData = await readFile('StreamingHistory.csv');

console.log('Loaded', allData.length, 'total records');

// **CRITICAL**: Filter for 2025 data (this is a 2025 Year in Review!)
const streamingData = allData.filter(record => {
  // Assuming 'ts' field contains timestamp
  const year = new Date(record.ts).getFullYear();
  return year === currentYear; // currentYear = 2025
});

console.log('2025 records:', streamingData.length);

const insights = [];

// 1. Total plays in 2025
insights.push({
  id: 'total-plays-2025',
  type: 'statistic',
  category: 'music',
  title: 'Total Plays in 2025',
  value: { number: streamingData.length },
  metadata: {
    timeframe: '2025',
    source: 'StreamingHistory.csv'
  }
});

// 2. Total minutes listened
const totalMs = _.sumBy(streamingData, 'ms_played');
const totalMinutes = Math.round(totalMs / 60000);

insights.push({
  id: 'total-minutes',
  type: 'statistic',
  category: 'music',
  title: 'Minutes Listened',
  value: {
    number: totalMinutes,
    label: 'minutes'
  },
  metadata: { unit: 'minutes' }
});

// 3. Top 5 artists (using lodash)
const artistCounts = _.countBy(
  streamingData,
  'master_metadata_album_artist_name'
);

const topArtists = _.take(
  _.orderBy(
    Object.entries(artistCounts),
    [1],
    ['desc']
  ),
  5
).map(([name, count], index) => ({
  rank: index + 1,
  name: name || 'Unknown',
  value: count
}));

insights.push({
  id: 'top-artists',
  type: 'ranking',
  category: 'music',
  title: 'Top 5 Artists',
  value: { items: topArtists }
});

// 4. Unique artists count
const uniqueArtists = new Set(
  streamingData
    .map(r => r.master_metadata_album_artist_name)
    .filter(Boolean)
);

insights.push({
  id: 'unique-artists',
  type: 'statistic',
  category: 'music',
  title: 'Unique Artists',
  value: {
    number: uniqueArtists.size,
    label: 'artists'
  }
});

return insights;
\`\`\`

## Iteration Strategy

**Phase 1: Understand the Data**
- First, use read_file to examine 1-2 key data files
- Look at actual column names, data types, sample values
- Plan which insights to generate

**Phase 2: Start Simple**
- Write code for ONE simple insight first (like total count)
- Execute it to verify file access and basic structure work
- See the actual data structure in console.log output

**Phase 3: Fix Errors**
- If code fails, read the error message carefully
- Common issues:
  - Wrong column names → Check actual columns in data
  - Undefined values → Add null checks (use \`filter(Boolean)\`)
  - File path errors → Verify exact path from discoveries
  - Parsing errors → Examine data format
- Use console.log to debug values
- Add try-catch for robustness

**Phase 4: Expand**
- Once one insight works, add more
- Build on working patterns
- Reuse helper logic

**Phase 5: Complete**
- Aim for 5-15 quality insights
- Cover different insight types (statistic, ranking, timeline, etc.)
- Return the final insights array
- Explicitly state you're done

## Error Handling Patterns

\`\`\`javascript
// Handle missing fields
const validRecords = data.filter(r => r.artist_name);

// Safe property access
const artistName = record.artist_name || 'Unknown';

// Try-catch for file operations
try {
  const data = await readFile('data.csv');
  // process data
} catch (error) {
  console.log('Failed to read file:', error.message);
  // Return partial results or empty array
}

// Defensive aggregation
const total = _.sumBy(
  data.filter(r => typeof r.value === 'number'),
  'value'
);
\`\`\`

## Important Notes

- **Use exact column names** from discoveries - don't guess!
- **Always return a value** - the insights array
- **Log liberally** - console.log helps you debug
- **Start simple** - one insight at a time
- **Test incrementally** - execute often to catch errors early
- **Stop when done** - explicitly state completion (don't iterate forever)
- **Handle nulls** - real data is messy, filter/check for undefined
- **Be creative** - generate interesting, fun insights based on data

Begin by examining the discoveries and planning your approach!`;

export interface CodeWriterAgentOptions {
  rootHandle: FileSystemDirectoryHandle;
  discoveries: Discovery[];
  apiKey: string;
  model?: string;
  maxIterations?: number;
  onCheckpoint?: (data: CheckpointData, iteration: number) => void;
  resumeFrom?: CheckpointData;
  additionalGuidance?: string;
}

export interface CodeWriterAgent {
  run: () => Promise<AgentResult>;
  stop: () => void;
  on: (listener: AgentEventListener) => () => void;
}

/**
 * Format discoveries into a readable summary for the agent
 */
function formatDiscoveries(discoveries: Discovery[]): string {
  const lines: string[] = [];

  // Group discoveries by type
  const files = discoveries.filter((d) => d.type === 'file');
  const dataTypes = discoveries.filter((d) => d.type === 'data_type');
  const patterns = discoveries.filter((d) => d.type === 'pattern');

  lines.push('# Exploration Discoveries\n');

  // Data type files with format information
  if (dataTypes.length > 0) {
    lines.push('## Data Files Found\n');
    for (const discovery of dataTypes) {
      lines.push(`### ${discovery.path}`);
      lines.push(`- Description: ${discovery.description}`);

      if (discovery.metadata) {
        if (discovery.metadata.fileType) {
          lines.push(`- Type: ${discovery.metadata.fileType}`);
        }
        if (discovery.metadata.columns && Array.isArray(discovery.metadata.columns)) {
          lines.push(
            `- Columns (${discovery.metadata.columns.length}): ${discovery.metadata.columns.join(', ')}`
          );
        }
        if (discovery.metadata.jsonStructure) {
          lines.push(`- Structure: ${discovery.metadata.jsonStructure}`);
        }
        if (discovery.metadata.delimiter) {
          lines.push(`- Delimiter: "${discovery.metadata.delimiter}"`);
        }
      }
      lines.push('');
    }
  }

  // Other files
  if (files.length > 0) {
    lines.push('## Other Files\n');
    for (const file of files.slice(0, 20)) {
      // Limit to first 20
      lines.push(`- ${file.path}: ${file.description}`);
    }
    if (files.length > 20) {
      lines.push(`... and ${files.length - 20} more files`);
    }
    lines.push('');
  }

  // Patterns discovered
  if (patterns.length > 0) {
    lines.push('## Patterns\n');
    for (const pattern of patterns) {
      lines.push(`- ${pattern.description}`);
    }
    lines.push('');
  }

  lines.push(
    '\n**Important**: Use the EXACT column names and file paths shown above in your code!'
  );

  return lines.join('\n');
}

/**
 * Parse insights from agent result
 */
export function parseInsightsFromResult(result: AgentResult): Insight[] {
  // Look for insights in discoveries with type 'insight'
  const insightDiscoveries = result.discoveries.filter((d) => d.type === 'insight' as any);

  if (insightDiscoveries.length > 0) {
    return insightDiscoveries
      .map((d) => d.metadata?.insight)
      .filter(Boolean) as Insight[];
  }

  // Fallback: try to extract from the summary or conversation history
  // Look for insights in the final message or tool results
  const lastMessage = result.conversationHistory[result.conversationHistory.length - 1];

  if (lastMessage && lastMessage.role === 'assistant') {
    // Try to find insights in tool results
    for (let i = result.conversationHistory.length - 1; i >= 0; i--) {
      const msg = result.conversationHistory[i];
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (
            block.type === 'tool_result' &&
            block.content &&
            typeof block.content === 'string'
          ) {
            // Try to extract insights from tool result
            try {
              const match = block.content.match(/Return value:\s*\n([\s\S]*?)(?=\n\n|$)/);
              if (match) {
                const jsonStr = match[1];
                const parsed = JSON.parse(jsonStr);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  return parsed;
                }
              }
            } catch {
              // Continue searching
            }
          }
        }
      }
    }
  }

  return [];
}

/**
 * Create a code-writing agent
 */
export function createCodeWriterAgent(
  options: CodeWriterAgentOptions
): CodeWriterAgent {
  const {
    rootHandle,
    discoveries,
    apiKey,
    model = 'claude-sonnet-4-5-20250929',
    maxIterations = 25,
    onCheckpoint,
    resumeFrom,
    additionalGuidance,
  } = options;

  const client = createClient(apiKey, model);
  const tools = createCodeWriterTools(rootHandle);

  // Build initial prompt with discoveries
  const discoveriesSummary = formatDiscoveries(discoveries);
  let initialPrompt = `Based on the exploration findings below, write JavaScript code to analyze this data and generate interesting insights for a "Year in Review" summary.

${discoveriesSummary}

Please:
1. Examine the data files to understand their actual structure
2. Write code to generate 5-15 interesting insights
3. Execute your code and iterate on any errors
4. Return an array of insight objects in the specified format

Start by reading one of the key data files to see its actual structure!`;

  if (additionalGuidance) {
    initialPrompt += `\n\nAdditional guidance: ${additionalGuidance}`;
  }

  const config: AgentConfig = {
    name: 'CodeWriterAgent',
    description: 'Writes JavaScript code to analyze data and generate insights',
    systemPrompt: CODE_WRITER_SYSTEM_PROMPT,
    tools,
    maxIterations,
  };

  const runner = new AgentRunner(config, client, {
    onCheckpoint,
    checkpointInterval: 3,
  });

  return {
    run: () => {
      if (resumeFrom) {
        return runner.resume(resumeFrom);
      }
      return runner.run(initialPrompt);
    },
    stop: () => runner.stop(),
    on: (listener: AgentEventListener) => runner.on(listener),
  };
}
