import { chromium, Browser, BrowserContext, Page, Request as PlaywrightRequest, Response as PlaywrightResponse } from 'playwright';
import { prisma } from '../database/prisma';
import { config } from '../config';
import { wsManager } from '../websocket';
import { logger } from '../utils/logger';
import { vncManager } from './vnc';
import { isAllowedEducationalUrl } from './security';
import { platformAdapterRegistry } from './adapters';
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
      // 2. Launch Chromium according to BROWSER_MODE ('local' = headed, 'production' = headless)
      const isLocalMode = config.browser.mode === 'local' && process.env.NODE_ENV !== 'test';
      const isHeadless = !isLocalMode;

      logger.info(
        `[BrowserService] Launching session ${sessionId} in ${
          isLocalMode ? 'LOCAL (Headed - visible window)' : 'PRODUCTION (Headless)'
        } mode`
      );

      const browserArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
      ];

      // If running on Linux/Railway with virtual display
      if (!isLocalMode && process.platform === 'linux') {
        browserArgs.push(`--display=:${displayInfo.displayNumber}`);
      }

      const browser = await chromium.launch({
        headless: isHeadless,
        args: browserArgs,
        env: {
          ...process.env,
          ...(process.platform === 'linux' ? { DISPLAY: `:${displayInfo.displayNumber}` } : {}),
        },
      });

      // 3. Isolated incognito browser context for the student
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        locale: 'en-US',
      });

      const page = await context.newPage();

      // Network Monitoring: Track failed requests, status codes, and potential platform blocks
      page.on('response', (res: PlaywrightResponse) => {
        if (res.status() >= 400) {
          logger.warn(`[NetworkMonitor] Session ${sessionId} response: ${res.status()} ${res.url()}`);
        }
      });
      page.on('requestfailed', (req: PlaywrightRequest) => {
        logger.warn(`[NetworkMonitor] Session ${sessionId} request failed: ${req.url()} (${req.failure()?.errorText})`);
      });

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

      // 4. Navigate to Target URL with retry handling
      logger.info(`Session ${sessionId} navigating to: ${targetUrl}`);
      wsManager.emitTaskProgress(sessionId, 'Navigating to educational portal', 40);

      let navSuccess = false;
      let lastNavError = '';
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          navSuccess = true;
          break;
        } catch (navErr: any) {
          lastNavError = navErr.message;
          logger.warn(`Navigation attempt ${attempt} failed for session ${sessionId}: ${lastNavError}`);
          if (attempt < 2) await page.waitForTimeout(2000);
        }
      }

      if (!navSuccess) {
        throw new Error(`Failed to navigate to platform after 2 attempts: ${lastNavError}`);
      }

      // Handle optional student authorized credentials auto-fill using Platform Adapter
      if (credentials) {
        const adapter = platformAdapterRegistry.getAdapterForUrl(targetUrl);
        await adapter.login(page, credentials);
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
   * Scans current page DOM to detect questions and multi-choice selections using Platform Adapters
   */
  public async extractQuestion(sessionId: string): Promise<ExtractedQuestionData | null> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.page) {
      throw new Error('Active session not found');
    }

    session.lastActivity = new Date();
    const page = session.page;

    const adapter = platformAdapterRegistry.getAdapterForUrl(page.url());
    const detectedList = await adapter.detectQuestions(page);

    if (!detectedList || detectedList.length === 0) {
      return null;
    }

    const firstQuestion = detectedList[0];

    // Capture screenshot of question area
    let imageBase64: string | undefined;
    try {
      const screenshotBuffer = await page.screenshot({ fullPage: false });
      imageBase64 = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
    } catch {
      // Continue even if screenshot fails
    }

    const result: ExtractedQuestionData = {
      text: firstQuestion.text,
      type: firstQuestion.type,
      options: firstQuestion.options,
      image: imageBase64,
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

  /**
   * Safe interactive action (click button, choose option, navigate next)
   */
  public async interact(
    sessionId: string,
    action: 'click' | 'select' | 'navigate' | 'type',
    target: { selector?: string; text?: string; value?: string; url?: string }
  ): Promise<{ success: boolean; currentUrl: string; message: string }> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.page) {
      throw new Error('Active session not found');
    }

    session.lastActivity = new Date();
    const page = session.page;

    logger.info(`[BrowserService] Session ${sessionId} executing action '${action}'`);

    if (action === 'navigate' && target.url) {
      const urlCheck = isAllowedEducationalUrl(target.url);
      if (!urlCheck.allowed) {
        throw new Error(`Target navigation forbidden: ${urlCheck.reason}`);
      }
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      return { success: true, currentUrl: page.url(), message: `Navigated to ${target.url}` };
    }

    if (action === 'click') {
      let locator = target.selector ? page.locator(target.selector).first() : null;
      if (!locator && target.text) {
        locator = page.locator(`button:has-text("${target.text}"), a:has-text("${target.text}"), [role="button"]:has-text("${target.text}")`).first();
      }

      if (!locator || !(await locator.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Error(`Click target not found or not visible: ${target.selector || target.text}`);
      }

      await locator.click();
      await page.waitForTimeout(1500);
      return { success: true, currentUrl: page.url(), message: `Clicked element successfully` };
    }

    if (action === 'select' && target.value) {
      const optionLocator = page.locator(`label:has-text("${target.value}"), input[value="${target.value}"]`).first();
      if (await optionLocator.isVisible({ timeout: 5000 }).catch(() => false)) {
        await optionLocator.click();
        return { success: true, currentUrl: page.url(), message: `Selected option: ${target.value}` };
      }
      throw new Error(`Option element not found: ${target.value}`);
    }

    if (action === 'type' && target.selector && target.value) {
      const inputLocator = page.locator(target.selector).first();
      await inputLocator.fill(target.value);
      return { success: true, currentUrl: page.url(), message: `Typed value into input` };
    }

    return { success: false, currentUrl: page.url(), message: 'Unsupported interaction' };
  }

  /**
   * Inspect current page and discover sections, available links, and interactive buttons
   */
  public async getPageOverview(sessionId: string): Promise<{
    url: string;
    title: string;
    navigationItems: string[];
    availableButtons: string[];
  }> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.page) {
      throw new Error('Active session not found');
    }

    session.lastActivity = new Date();
    const page = session.page;

    const title = await page.title();
    const navigationItems = await page.$$eval('nav a, aside a, header a, .menu-item', (els) =>
      els.map((e) => e.textContent?.trim()).filter((t): t is string => !!t && t.length > 1).slice(0, 15)
    );

    const availableButtons = await page.$$eval(
      'button:not([disabled]), [role="button"]:not([disabled])',
      (els) => els.map((e) => e.textContent?.trim()).filter((t): t is string => !!t && t.length > 1).slice(0, 15)
    );

    return {
      url: page.url(),
      title,
      navigationItems,
      availableButtons,
    };
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
