/**
 * Screenshot Presentation Tool
 * Captures the current state of the presentation iframe as an image
 */

import type { Tool, ToolResult } from '../types';
import type { PresentationExecutor } from '../../services/presentationExecution';

interface ScreenshotPresentationInput {
  reason?: string;
}

export function createScreenshotPresentationTool(
  executor: PresentationExecutor,
  onScreenshot?: (dataUrl: string) => void
): Tool {
  return {
    name: 'screenshot_presentation',
    description: `Capture a screenshot of the current presentation state.

Use this tool to see how your presentation looks visually. The screenshot will be returned as an image that you can analyze to:
- Check if animations are positioned correctly
- Verify text readability and sizing
- Ensure colors and styling match the celebratory tone
- Identify layout issues
- Confirm the presentation is visually appealing

After seeing the screenshot, you can iterate on your HTML/CSS/JS to improve the design.

Call this tool after using execute_presentation_code to see your work.`,

    inputSchema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Optional: Why you are taking this screenshot (for logging)',
        },
      },
      required: [],
    },

    async execute(input: unknown): Promise<ToolResult> {
      const { reason } = (input as ScreenshotPresentationInput) || {};

      try {
        const result = await executor.screenshot();

        if (!result.success) {
          return {
            success: false,
            output: `Screenshot failed: ${result.error}`,
            data: null,
          };
        }

        // Notify parent component with screenshot data
        if (onScreenshot && result.dataUrl) {
          onScreenshot(result.dataUrl);
        }

        const output = [
          '📸 Screenshot captured!',
          reason ? `Reason: ${reason}` : '',
          '',
          'Analyze the screenshot to check:',
          '- Visual hierarchy and layout',
          '- Text readability and sizing',
          '- Animation positioning',
          '- Color scheme and mood',
          '- Overall aesthetic quality',
          '',
          'If you see issues, write improved HTML/CSS/JS and execute again.',
        ]
          .filter(Boolean)
          .join('\n');

        return {
          success: true,
          output,
          data: {
            dataUrl: result.dataUrl,
            timestamp: Date.now(),
            // Include image in data for vision analysis
            includeImage: true,
          },
        };
      } catch (error) {
        return {
          success: false,
          output: `Error capturing screenshot: ${error instanceof Error ? error.message : String(error)}`,
          data: null,
        };
      }
    },
  };
}
