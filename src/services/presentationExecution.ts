/**
 * Presentation Execution Service
 * Executes agent-generated HTML/CSS/JS in a sandboxed iframe
 */

export interface PresentationExecutionResult {
  success: boolean;
  error?: string;
  html: string;
  timestamp: number;
}

export interface ScreenshotResult {
  success: boolean;
  dataUrl?: string;
  error?: string;
}

/**
 * PresentationExecutor - Manages iframe-based presentation rendering
 */
export class PresentationExecutor {
  private iframe: HTMLIFrameElement | null = null;
  private iframeContainer: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.iframeContainer = container;
  }

  /**
   * Execute HTML/CSS/JS code in sandboxed iframe
   */
  async execute(html: string): Promise<PresentationExecutionResult> {
    try {
      // Clean up existing iframe
      if (this.iframe) {
        this.iframe.remove();
      }

      // Create new iframe
      this.iframe = document.createElement('iframe');
      this.iframe.sandbox.add('allow-scripts');
      this.iframe.sandbox.add('allow-same-origin'); // Required to access iframe document for screenshots
      this.iframe.style.width = '100%';
      this.iframe.style.height = '100%';
      this.iframe.style.border = 'none';
      this.iframe.style.background = '#000';

      // Inject watermark into HTML
      const watermarkedHtml = this.injectWatermark(html);

      // Set HTML content
      this.iframe.srcdoc = watermarkedHtml;

      // Append to container
      if (!this.iframeContainer) {
        throw new Error('Container not available');
      }
      this.iframeContainer.appendChild(this.iframe);

      // Wait for iframe to load
      await new Promise<void>((resolve, reject) => {
        if (!this.iframe) {
          reject(new Error('Iframe not created'));
          return;
        }

        const timeout = setTimeout(() => {
          reject(new Error('Iframe load timeout'));
        }, 10000);

        this.iframe.addEventListener('load', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.iframe.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('Iframe load error'));
        });
      });

      // Give scripts time to execute
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return {
        success: true,
        html,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        html,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Inject yirgachefe.lol watermark into HTML content
   */
  private injectWatermark(html: string): string {
    const watermarkHTML = `
    <a href="https://yirgachefe.lol" target="_blank" rel="noopener noreferrer"
       style="position: fixed;
              bottom: 20px;
              right: 20px;
              color: rgba(255, 255, 255, 0.4);
              font-size: 14px;
              font-weight: 500;
              text-decoration: none;
              z-index: 999999;
              padding: 6px 12px;
              border-radius: 4px;
              background: rgba(0, 0, 0, 0.3);
              backdrop-filter: blur(4px);
              transition: all 0.2s ease;
              font-family: system-ui, -apple-system, sans-serif;
              pointer-events: auto;">
      yirgachefe.lol
    </a>
    <style>
      a[href="https://yirgachefe.lol"]:hover {
        color: rgba(255, 255, 255, 0.8) !important;
        background: rgba(0, 0, 0, 0.5) !important;
        transform: translateY(-2px);
      }
    </style>`;

    // Try to inject before </body> tag
    if (html.includes('</body>')) {
      return html.replace('</body>', `${watermarkHTML}</body>`);
    }

    // Try to inject before </html> tag
    if (html.includes('</html>')) {
      return html.replace('</html>', `${watermarkHTML}</html>`);
    }

    // Otherwise append to end
    return html + watermarkHTML;
  }

  /**
   * Capture screenshot of current iframe content
   */
  async screenshot(): Promise<ScreenshotResult> {
    try {
      if (!this.iframe || !this.iframe.contentWindow) {
        throw new Error('No iframe loaded');
      }

      // Get iframe document
      const iframeDoc = this.iframe.contentDocument || this.iframe.contentWindow.document;
      if (!iframeDoc.body) {
        throw new Error('Iframe document not ready');
      }

      // Give animations extra time to settle before capturing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Import html2canvas dynamically
      const html2canvas = (await import('html2canvas')).default;

      // Capture screenshot with increased scale for better quality
      const canvas = await html2canvas(iframeDoc.body, {
        allowTaint: true,
        useCORS: true,
        logging: false,
        backgroundColor: '#000000',
        scale: 1,
        windowWidth: iframeDoc.documentElement.scrollWidth,
        windowHeight: iframeDoc.documentElement.scrollHeight,
      });

      // Convert to data URL
      const dataUrl = canvas.toDataURL('image/png');

      return {
        success: true,
        dataUrl,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Clean up iframe
   */
  destroy() {
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
  }

  /**
   * Get current iframe element (for external access)
   */
  getIframe(): HTMLIFrameElement | null {
    return this.iframe;
  }
}
