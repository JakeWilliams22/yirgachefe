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
  onScreenshot?: (dataUrl: string[]) => void
): Tool {
  return {
    name: 'screenshot_presentation',
    description: `Capture 3 screenshots of the presentation at different points in time.

Use this tool to see how your presentation looks visually across multiple slides/animations.
This captures 3 screenshots as the presentation auto-advances, allowing you to see:
- Different slides in your presentation
- How animations progress
- Visual consistency across the experience

The screenshots will be returned as images that you can analyze to:
- Check if animations are positioned correctly
- Verify text readability and sizing
- Ensure colors and styling match the celebratory tone
- Identify layout issues
- Confirm the presentation is visually appealing across multiple slides

After seeing the screenshots, you can iterate on your HTML/CSS/JS to improve the design.

Call this tool after using execute_presentation_code to see your work.`,

    inputSchema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Optional: Why you are taking these screenshots (for logging)',
        },
      },
      required: [],
    },

    async execute(input: unknown): Promise<ToolResult> {
      const { reason } = (input as ScreenshotPresentationInput) || {};

      try {
        // Always capture 3 screenshots
        const results = await executor.screenshotMultiple(3);

        // Check if any screenshots succeeded
        const successfulResults = results.filter(r => r.success && r.dataUrl);
        if (successfulResults.length === 0) {
          const errors = results.map(r => r.error).filter(Boolean).join(', ');
          return {
            success: false,
            output: `All screenshots failed: ${errors}`,
            data: null,
          };
        }

        // Notify parent component with screenshot data
        if (onScreenshot) {
          const dataUrls = successfulResults.map(r => r.dataUrl!);
          onScreenshot(dataUrls);
        }

        const output = [
          `📸 ${successfulResults.length}/3 screenshots captured at different time intervals!`,
          reason ? `Reason: ${reason}` : '',
          '',
          'Analyze the screenshots to check:',
          '- Visual hierarchy and layout',
          '- Text readability and sizing',
          '- Animation positioning',
          '- Color scheme and mood',
          '- Overall aesthetic quality',
          '- Consistency across different slides',
          '',
          'If you see issues, write improved HTML/CSS/JS and execute again.',
        ]
          .filter(Boolean)
          .join('\n');

        return {
          success: true,
          output,
          data: {
            dataUrls: successfulResults.map(r => r.dataUrl),
            timestamp: Date.now(),
            // Include images in data for vision analysis
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
