import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { prisma } from '../database/prisma';
import { wsManager } from '../websocket';
import { logger } from '../utils/logger';
import { vncManager } from './vnc';
import { isAllowedEducationalUrl } from './security';
import { ExtractedQuestionData } from '../types';

export interface ActiveSessionContext {
  sessionId: string;
  userId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  vncUrl: string;
  lastActivity: Date;
  status: 'INITIALIZING' | 'RUNNING' | 'IDLE' | 'PAUSED' | 'STOPPED' | 'ERROR';
}

export class BrowserService {
  private activeSessions: Map<string, ActiveSessionContext> = new Map();
  private idleCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startIdleChecker();
  }

  /**
   * Launch an isolated Chromium session bound to its own virtual Xvfb display
   */
  public async startSession(
    sessionId: string,
    userId: string,
    targetUrl: string,
    credentials?: { username: string; password?: string }
  ): Promise<ActiveSessionContext> {
    // Check security / SSRF / Whitelist
    const urlCheck = isAllowedEducationalUrl(targetUrl);
    if (!urlCheck.allowed) {
      throw new Error(`Forbidden target URL: ${urlCheck.reason}`);
    }

    // 1. Setup isolated VNC display
    const displayInfo = await vncManager.allocateDisplay(sessionId);

    // Update session status in DB
    await prisma.browserSession.update({
      where: { id: sessionId },
      data: {
        sessionStatus: 'INITIALIZING',
        browserStatus: 'LAUNCHING',
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });

    wsManager.emitBrowserStatus(sessionId, 'INITIALIZING', {
      display: displayInfo.displayNumber,
      vncUrl: displayInfo.novncUrl,
    });

    try {
      // 2. Launch Chromium with isolated DISPLAY environment
      const browser = await chromium.launch({
        headless: process.env.NODE_ENV === 'test' ? true : false,
        args: [
          `--display=:${displayInfo.displayNumber}`,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1280,800',
        ],
        env: {
          ...process.env,
          DISPLAY: `:${displayInfo.displayNumber}`,
        },
      });

      // 3. Isolated incognito browser context for the student
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      const page = await context.newPage();

      const sessionObj: ActiveSessionContext = {
        sessionId,
        userId,
        browser,
        context,
        page,
        vncUrl: displayInfo.novncUrl,
        lastActivity: new Date(),
        status: 'RUNNING',
      };

      this.activeSessions.set(sessionId, sessionObj);

      // 4. Navigate to Target URL
      logger.info(`Session ${sessionId} navigating to: ${targetUrl}`);
      wsManager.emitTaskProgress(sessionId, 'Navigating to educational portal', 40);

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Handle optional student authorized credentials auto-fill
      if (credentials) {
        await this.handleSafeAutoFill(page, credentials);
      }

      // Update session status to RUNNING
      await prisma.browserSession.update({
        where: { id: sessionId },
        data: {
          sessionStatus: 'RUNNING',
          browserStatus: 'CONNECTED',
          lastActivityAt: new Date(),
        },
      });

      await prisma.browserEvent.create({
        data: {
          sessionId,
          eventType: 'PAGE_LOADED',
          eventDescription: `Navigated to ${targetUrl}`,
          eventStatus: 'SUCCESS',
          metadata: { url: targetUrl },
        },
      });

      wsManager.emitBrowserStarted(sessionId, {
        status: 'RUNNING',
        vncUrl: displayInfo.novncUrl,
        currentUrl: page.url(),
      });

      return sessionObj;
    } catch (err: any) {
      logger.error(`Error starting browser session ${sessionId}: ${err.message}`);
      await this.terminateSession(sessionId, 'ERROR');
      wsManager.emitBrowserError(sessionId, err.message);
      throw err;
    }
  }

  /**
   * Safe auto-fill without leaking credentials into logs
   */
  private async handleSafeAutoFill(
    page: Page,
    credentials: { username: string; password?: string }
  ) {
    try {
      // Find standard username / email input fields
      const userInput = await page.$(
        'input[type="text"], input[type="email"], input[name*="user"], input[name*="login"]'
      );
      if (userInput) {
        await userInput.fill(credentials.username);
      }

      if (credentials.password) {
        const passInput = await page.$('input[type="password"]');
        if (passInput) {
          await passInput.fill(credentials.password);
        }
      }
    } catch (e: any) {
      logger.warn(`Auto-fill skipped: ${e.message}`);
    }
  }

  /**
   * Scans current page DOM to detect questions and multi-choice selections
   */
  public async extractQuestion(sessionId: string): Promise<ExtractedQuestionData | null> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.page) {
      throw new Error('Active session not found');
    }

    session.lastActivity = new Date();
    const page = session.page;

    const detected = await page.evaluate(() => {
      // Look for standard question wrappers (e.g., .question, [data-question], form items)
      const qElements = document.querySelectorAll(
        '.question, [data-question], .quiz-question, .form-group, fieldset, [role="radiogroup"]'
      );

      let text = '';
      const options: string[] = [];

      if (qElements.length > 0) {
        const first = qElements[0];
        text = first.textContent?.trim().slice(0, 1000) || '';

        // Extract options from radio buttons / labels
        const optElements = first.querySelectorAll('label, input[type="radio"], li');
        optElements.forEach((el: Element) => {
          const optText = el.textContent?.trim();
          if (optText && optText.length > 1 && !options.includes(optText)) {
            options.push(optText);
          }
        });
      } else {
        // Fallback: Grab the primary heading or prompt
        const h = document.querySelector('h1, h2, h3, p');
        text = h?.textContent?.trim() || '';
      }

      return {
        text,
        options,
      };
    });

    if (!detected.text) {
      return null;
    }

    // Capture screenshot of question area
    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const imageBase64 = screenshotBuffer.toString('base64');

    const result: ExtractedQuestionData = {
      text: detected.text,
      type: detected.options.length > 0 ? 'MULTIPLE_CHOICE' : 'SHORT_ANSWER',
      options: detected.options,
      image: `data:image/png;base64,${imageBase64}`,
    };

    // Save detected question in database
    const savedQuestion = await prisma.question.create({
      data: {
        sessionId,
        questionText: result.text,
        questionType: result.type,
        questionImage: result.image,
        extractedOptions: result.options || [],
      },
    });

    wsManager.emitQuestionDetected(sessionId, {
      questionId: savedQuestion.id,
      text: result.text,
      options: result.options,
    });

    return result;
  }

  /**
   * Take page screenshot on demand
   */
  public async takeScreenshot(sessionId: string): Promise<string> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.page) {
      throw new Error('Active session not found');
    }
    session.lastActivity = new Date();
    const buffer = await session.page.screenshot({ type: 'png' });
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }

  /**
   * Stop/terminate active session
   */
  public async terminateSession(
    sessionId: string,
    reason: 'STOPPED' | 'ERROR' = 'STOPPED'
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      try {
        await session.context?.close();
        await session.browser?.close();
      } catch (err: any) {
        logger.warn(`Error closing Playwright instance: ${err.message}`);
      }
      this.activeSessions.delete(sessionId);
    }

    // Clean up VNC displays and processes
    vncManager.cleanupDisplay(sessionId);

    // Update DB
    await prisma.browserSession.update({
      where: { id: sessionId },
      data: {
        sessionStatus: reason === 'ERROR' ? 'ERROR' : 'STOPPED',
        browserStatus: 'DISCONNECTED',
        endedAt: new Date(),
      },
    });

    wsManager.emitBrowserStopped(sessionId);
    logger.info(`Session ${sessionId} terminated successfully (Status: ${reason})`);
  }

  public getSession(sessionId: string): ActiveSessionContext | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Idle checker to close inactive sessions after 15 minutes of inactivity
   */
  private startIdleChecker() {
    this.idleCheckInterval = setInterval(async () => {
      const now = Date.now();
      const MAX_IDLE_MS = 15 * 60 * 1000; // 15 minutes

      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (now - session.lastActivity.getTime() > MAX_IDLE_MS) {
          logger.info(`Closing idle browser session ${sessionId}`);
          await this.terminateSession(sessionId, 'STOPPED');
        }
      }
    }, 60000);
  }
}

export const browserService = new BrowserService();
