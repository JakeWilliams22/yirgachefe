/**
 * Tool for executing JavaScript code in a sandboxed environment
 */

import { Tool, ToolResult } from '../types';
import { CodeExecutor } from '../../services/codeExecution';

/**
 * Input schema for the execute_code tool
 */
interface ExecuteCodeInput {
  code: string;
  description?: string;
}

/**
 * Creates the execute_code tool
 */
export function createExecuteCodeTool(
  rootHandle: FileSystemDirectoryHandle
): Tool {
  const executor = new CodeExecutor(rootHandle);

  return {
    name: 'execute_code',
    description: `Execute JavaScript code to analyze data and generate insights.

The code runs in a sandboxed environment with access to:
- **Papa**: PapaParse library for CSV parsing
- **dateFns**: date-fns library for date manipulation
- **_**: lodash library for data utilities
- **pako**: Pako library for gzip compression/decompression
- **FitParser**: FIT file parser for Garmin/fitness device data
- **readFile(path)**: Async function to read and auto-parse files
  - CSV/TSV files → Returns array of objects with headers as keys
  - JSON files → Returns parsed JSON object/array
  - JSONL files → Returns array of parsed JSON objects
  - Other files → Returns raw text content
- **readFileBinary(path)**: Async function to read binary files
  - Returns Uint8Array for binary data (gzip, FIT files, etc.)
  - Use with pako.ungzip() for .gz files
  - Use with FitParser for .fit files
- **console.log(...)**: Logs are captured and returned to you
- **Date/Time Context**:
  - **currentDate**: Current date as Date object
  - **currentYear**: Current year (e.g., 2025)
  - **currentMonth**: Current month (1-12)
  - **today**: Current date as YYYY-MM-DD string

Your code MUST return a value. For insight generation, return an array of insight objects:
[
  {
    id: 'unique-id',
    type: 'statistic' | 'ranking' | 'timeline' | 'comparison' | 'distribution' | 'achievement',
    category: 'music' | 'fitness' | 'social' | 'productivity' | 'entertainment' | 'general',
    title: 'User-facing title',
    value: { /* type-specific structure */ },
    metadata?: { unit?: string, timeframe?: string, source?: string }
  }
]

Example code:
\`\`\`javascript
// Read data file (auto-parsed as CSV with headers)
const data = await readFile('StreamingHistory.csv');

console.log('Loaded', data.length, 'records');

// Process data
const insights = [];

// Statistic: Total plays
insights.push({
  id: 'total-plays',
  type: 'statistic',
  category: 'music',
  title: 'Total Plays',
  value: { number: data.length },
  metadata: { source: 'StreamingHistory.csv' }
});

// Ranking: Top artists
const artistCounts = _.countBy(data, 'master_metadata_album_artist_name');
const topArtists = _.take(
  _.orderBy(Object.entries(artistCounts), [1], ['desc']),
  5
).map(([name, count], index) => ({
  rank: index + 1,
  name,
  value: count
}));

insights.push({
  id: 'top-artists',
  type: 'ranking',
  category: 'music',
  title: 'Top 5 Artists',
  value: { items: topArtists }
});

return insights;
\`\`\`

Example with compressed FIT files (Garmin/fitness data):
\`\`\`javascript
// Read a compressed FIT file
const compressed = await readFileBinary('activity.fit.gz');

// Decompress with pako
const decompressed = pako.ungzip(compressed);

// Parse FIT data
const fitParser = new FitParser();
const fitData = fitParser.parse(decompressed.buffer);

console.log('FIT data:', fitData);

// Extract activities from 2025
const sessions = fitData.activity?.sessions || [];
const sessions2025 = sessions.filter(s => {
  const year = new Date(s.start_time).getFullYear();
  return year === currentYear;
});

// Generate insights
const insights = [];
const totalDistance = _.sumBy(sessions2025, 'total_distance') / 1000; // Convert to km

insights.push({
  id: 'total-distance-2025',
  type: 'statistic',
  category: 'fitness',
  title: 'Total Distance in 2025',
  value: { number: Math.round(totalDistance), label: 'km' },
  metadata: { timeframe: '2025' }
});

return insights;
\`\`\`

IMPORTANT: Always return a value. Use try-catch for error handling. Check console.log output to debug issues.`,

    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The JavaScript code to execute. Must return a value.',
        },
        description: {
          type: 'string',
          description: 'Optional description of what this code does.',
        },
      },
      required: ['code'],
    },

    execute: async (input: unknown): Promise<ToolResult> => {
      const { code, description } = input as ExecuteCodeInput;

      // Validate code for dangerous patterns
      const validation = CodeExecutor.validateCode(code);
      if (!validation.valid) {
        return {
          success: false,
          output: `❌ Code validation failed: ${validation.reason}`,
        };
      }

      // Execute the code
      const result = await executor.execute(code);

      if (result.success) {
        // Format successful output
        let output = '✅ Code executed successfully';
        if (description) {
          output += ` (${description})`;
        }
        output += `\n\n⏱️  Execution time: ${result.executionTime}ms`;

        // Add console logs if any
        if (result.logs.length > 0) {
          output += '\n\n📝 Console output:\n' + result.logs.join('\n');
        }

        // Add return value
        if (result.output !== undefined) {
          output += '\n\n📤 Return value:\n';
          if (Array.isArray(result.output)) {
            output += `Array with ${result.output.length} items\n`;
            // Show first few items if array
            const preview = result.output.slice(0, 3);
            output += JSON.stringify(preview, null, 2);
            if (result.output.length > 3) {
              output += `\n... and ${result.output.length - 3} more items`;
            }
          } else if (typeof result.output === 'object' && result.output !== null) {
            output += JSON.stringify(result.output, null, 2);
          } else {
            output += String(result.output);
          }
        } else {
          output += '\n\n⚠️  Code did not return a value. Make sure to use "return" statement.';
        }

        return {
          success: true,
          output,
          data: result,
        };
      } else {
        // Format error output
        const error = result.error!;
        let output = `❌ Execution error: ${error.type}`;
        if (description) {
          output += ` (${description})`;
        }

        output += `\n\n${error.message}`;

        if (error.line) {
          output += `\n\n📍 Error at line ${error.line}`;
          if (error.column) {
            output += `, column ${error.column}`;
          }
        }

        // Add console logs if any (might help with debugging)
        if (result.logs.length > 0) {
          output += '\n\n📝 Console output before error:\n' + result.logs.join('\n');
        }

        output += `\n\n⏱️  Failed after ${result.executionTime}ms`;

        // Add debugging tips
        output += '\n\n💡 Debugging tips:';
        output += '\n- Use console.log() to inspect values';
        output += '\n- Check that file paths are correct';
        output += '\n- Verify column names match the data';
        output += '\n- Use try-catch for error handling';
        output += '\n- Make sure to return a value';

        return {
          success: false,
          output,
          data: result,
        };
      }
    },
  };
}
