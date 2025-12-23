/**
 * Execute Presentation Code Tool
 * Executes HTML/CSS/JS in sandboxed iframe for year-in-review presentations
 */

import type { Tool, ToolResult } from '../types';
import type { PresentationExecutor } from '../../services/presentationExecution';

interface ExecutePresentationCodeInput {
  html: string;
}

export function createExecutePresentationCodeTool(
  executor: PresentationExecutor
): Tool {
  return {
    name: 'execute_presentation_code',
    description: `Execute HTML/CSS/JavaScript code in a sandboxed iframe to create an animated year-in-review presentation.

The HTML should be a complete document with:
- Embedded CSS in <style> tags
- Embedded JavaScript in <script> tags
- Animation libraries loaded via CDN (GSAP, Anime.js, etc.)
- Full-screen slides/cards that present insights one-by-one
- Smooth transitions between screens
- Personal touches (user's name, celebration copy)

Available CDN libraries (include in your HTML):
- GSAP: https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js
- Anime.js: https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js
- Chart.js: https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js

The presentation will be rendered in a 1920x1080 viewport (desktop size).

Your HTML must include:
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Year in Review</title>
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    /* Your styles */
  </style>
</head>
<body>
  <!-- Your content -->
  <script src="CDN_URL"></script>
  <script>
    // Your animation code
  </script>
</body>
</html>`,

    inputSchema: {
      type: 'object',
      properties: {
        html: {
          type: 'string',
          description: 'Complete HTML document with embedded CSS and JavaScript',
        },
      },
      required: ['html'],
    },

    async execute(input: unknown): Promise<ToolResult> {
      const { html } = input as ExecutePresentationCodeInput;

      if (!html || typeof html !== 'string') {
        return {
          success: false,
          output: 'Error: html parameter must be a non-empty string',
          data: null,
        };
      }

      try {
        const result = await executor.execute(html);

        if (!result.success) {
          return {
            success: false,
            output: `Presentation execution failed: ${result.error}`,
            data: result,
          };
        }

        return {
          success: true,
          output: `✅ Presentation rendered successfully!\n\nThe presentation is now live in the iframe. Use the screenshot_presentation tool to see how it looks and iterate on the design.`,
          data: result,
        };
      } catch (error) {
        return {
          success: false,
          output: `Error executing presentation: ${error instanceof Error ? error.message : String(error)}`,
          data: null,
        };
      }
    },
  };
}
