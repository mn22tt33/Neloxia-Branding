import { chromium, Browser, BrowserContext, Page } from 'playwright';
import crypto from 'crypto';
import { Response } from 'express';
import { smartAnswerService } from '../ai/smart-answer.service';
import { wsManager } from '../websocket';
import { logger } from '../utils/logger';
import { config } from '../config';

export interface ChapterItem {
  id: string;
  title: string;
  unitName: string;
  status: 'PENDING' | 'EXPLORING' | 'SOLVING' | 'REVIEW' | 'COMPLETED' | 'ERROR';
  progressPercent: number;
}

export interface StudentSessionStats {
  detectedQuestions: number;
  savedToKnowledge: number;
  retrievedFromMemory: number;
  currentChapterIndex: number;
  totalChapters: number;
}

export interface LogEntry {
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

export interface StudentSessionState {
  sessionId: string;
  studentIdMasked: string;
  status: 'IDLE' | 'CONNECTING' | 'LOGGED_IN' | 'EXPLORING' | 'SOLVING' | 'STOPPED' | 'COMPLETED' | 'ERROR';
  progressPercent: number;
  chapters: ChapterItem[];
  stats: StudentSessionStats;
  logs: LogEntry[];
  errorMessage?: string;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  isStopping: boolean;
  sseClients: Set<Response>;
  createdAt: Date;
  lastActivityAt: Date;
}

export class SPXAutomationService {
  private static instance: SPXAutomationService;
  private activeSessions: Map<string, StudentSessionState> = new Map();
  private readonly MAX_CONCURRENT_SESSIONS = 5;

  private constructor() {}

  public static getInstance(): SPXAutomationService {
    if (!SPXAutomationService.instance) {
      SPXAutomationService.instance = new SPXAutomationService();
    }
    return SPXAutomationService.instance;
  }

  /**
   * Broadcast terminal message to WebSocket room and active SSE clients
   */
  public emitLog(
    sessionId: string,
    level: 'info' | 'success' | 'warn' | 'error',
    message: string,
    details?: any
  ) {
    const session = this.activeSessions.get(sessionId);
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0]; // HH:mm:ss
    const formattedLog = `[${timeStr}] ${message}`;

    // Buffer log in session history
    session?.logs.push({
      level,
      message: formattedLog,
      timestamp: now.toISOString(),
    });

    // 1. WebSocket broadcast
    wsManager.emitTerminalLog(sessionId, {
      level,
      message: formattedLog,
      percent: session?.progressPercent,
      stats: session?.stats,
      ...details,
    });

    // 2. Server-Sent Events (SSE) broadcast
    if (session && session.sseClients.size > 0) {
      const ssePayload = JSON.stringify({
        sessionId,
        level,
        message: formattedLog,
        percent: session.progressPercent,
        stats: session.stats,
        timestamp: now.toISOString(),
      });

      session.sseClients.forEach((res) => {
        try {
          res.write(`data: ${ssePayload}\n\n`);
        } catch {
          session.sseClients.delete(res);
        }
      });
    }

    if (level === 'error') {
      logger.error(`[SPX Session ${sessionId.substring(0, 8)}] ${message}`);
    } else {
      logger.info(`[SPX Session ${sessionId.substring(0, 8)}] ${message}`);
    }
  }

  /**
   * Register a new SSE listener for live terminal streaming
   */
  public subscribeSSE(sessionId: string, res: Response) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    session.sseClients.add(res);

    // Initial handshake ping
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', sessionId })}\n\n`);

    // Immediately replay all previous logs so client NEVER misses any event
    if (session.logs && session.logs.length > 0) {
      session.logs.forEach((log) => {
        res.write(`data: ${JSON.stringify({
          sessionId,
          level: log.level,
          message: log.message,
          percent: session.progressPercent,
          stats: session.stats,
          timestamp: log.timestamp,
        })}\n\n`);
      });
    }

    res.on('close', () => {
      session.sseClients.delete(res);
    });
  }

  /**
   * Start a fully isolated autonomous multi-student session
   */
  public async startSession(
    studentId: string,
    password: string,
    options: {
      subjectUrl?: string;
      maxLessons?: number;
      grade?: string;
      course?: string;
    } = {}
  ): Promise<{ sessionId: string }> {
    // 1. Capacity Check
    const activeRunningCount = Array.from(this.activeSessions.values()).filter(
      (s) => s.status !== 'COMPLETED' && s.status !== 'STOPPED' && s.status !== 'ERROR'
    ).length;

    if (activeRunningCount >= this.MAX_CONCURRENT_SESSIONS) {
      throw new Error(
        `السيرفر مشغول حالياً بمعالجة ${activeRunningCount} جلسات متزامنة. يرجى الانتظار بضع دقائق والمحاولة مجدداً.`
      );
    }

    // 2. Create isolated session state
    const sessionId = crypto.randomUUID();
    const maskedId = studentId.length > 4 ? `${studentId.substring(0, 3)}****` : '****';

    const sessionState: StudentSessionState = {
      sessionId,
      studentIdMasked: maskedId,
      status: 'CONNECTING',
      progressPercent: 5,
      chapters: [],
      stats: {
        detectedQuestions: 0,
        savedToKnowledge: 0,
        retrievedFromMemory: 0,
        currentChapterIndex: 0,
        totalChapters: 0,
      },
      logs: [],
      isStopping: false,
      sseClients: new Set(),
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.activeSessions.set(sessionId, sessionState);

    // Run execution pipeline asynchronously in background
    this.runPipeline(sessionId, studentId, password, options).catch((err) => {
      this.emitLog(sessionId, 'error', `خطأ غير متوقع في المعالجة: ${err.message}`);
      sessionState.status = 'ERROR';
    });

    return { sessionId };
  }

  /**
   * Stop an active student session gracefully
   */
  public async stopSession(sessionId: string): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;

    session.isStopping = true;
    session.status = 'STOPPED';
    this.emitLog(sessionId, 'warn', 'تم استلام طلب إيقاف الجلسة. جاري إغلاق المتصفح وتنظيف الذاكرة...');

    try {
      if (session.page && !session.page.isClosed()) {
        await session.page.close().catch(() => {});
      }
      if (session.context) {
        await session.context.close().catch(() => {});
      }
      if (session.browser) {
        await session.browser.close().catch(() => {});
      }
    } catch (err: any) {
      logger.warn(`Error closing browser for session ${sessionId}: ${err.message}`);
    }

    this.emitLog(sessionId, 'info', 'تم إيقاف الجلسة وعزل الموارد بنجاح.');
    return true;
  }

  /**
   * Get current session public status including buffered logs
   */
  public getSessionState(sessionId: string) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    return {
      sessionId: session.sessionId,
      studentIdMasked: session.studentIdMasked,
      status: session.status,
      progressPercent: session.progressPercent,
      chapters: session.chapters,
      stats: session.stats,
      logs: session.logs,
      errorMessage: session.errorMessage,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
    };
  }

  /**
   * Return recent logs from all active or recent sessions
   */
  public getAllRecentLogs(): Array<{ sessionId: string; studentId: string; logs: LogEntry[]; status: string; error?: string }> {
    return Array.from(this.activeSessions.values()).map((s) => ({
      sessionId: s.sessionId,
      studentId: s.studentIdMasked,
      status: s.status,
      error: s.errorMessage,
      logs: s.logs.slice(-30),
    }));
  }

  /**
   * Main Pipeline for student session execution
   */
  private async runPipeline(
    sessionId: string,
    studentId: string,
    password: string,
    options: { subjectUrl?: string; maxLessons?: number; grade?: string; course?: string }
  ) {
    const session = this.activeSessions.get(sessionId)!;
    const targetUrl = options.subjectUrl || 'https://egy.app.spx-learning-square.com/subjects/7/curriculum';
    const maxLessons = options.maxLessons || 42;
    const selectedCourse = options.course || 'javascript_ar';
    const selectedGrade = options.grade || 'g10';

    this.emitLog(sessionId, 'info', 'جاري الاتصال بالسيرفر وإنشاء جلسة متصفح معزولة...');
    this.emitLog(sessionId, 'info', `تم إنشاء جلسة مستقلة للطالب (${session.studentIdMasked}).`);

    const isLinux = process.platform === 'linux';
    // On Windows local development, run headed to guarantee 100% CloudFront bypass
    const isHeadless = isLinux ? true : (process.env.HEADLESS === 'true');

    // Launch Chromium with realistic browser flags & optional proxy support
    const browser = await chromium.launch({
      headless: isHeadless,
      proxy: config.proxy?.server
        ? {
            server: config.proxy.server,
            username: config.proxy.username || undefined,
            password: config.proxy.password || undefined,
          }
        : undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1366,768',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      locale: 'ar-EG',
      timezoneId: 'Africa/Cairo',
      geolocation: { longitude: 31.2357, latitude: 30.0444 },
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ar-EG,ar;q=0.9,en-US;q=0.8,en;q=0.7',
        'Upgrade-Insecure-Requests': '1',
        'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
      },
    });

    // Deep stealth injections to emulate authentic human Chrome session
    await context.addInitScript(() => {
      // Overwrite navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // Chrome runtime mock
      (window as any).chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: {} };
      // Real languages array
      Object.defineProperty(navigator, 'languages', { get: () => ['ar-EG', 'ar', 'en-US', 'en'] });
      // Hardware concurrency
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      // Real plugins mock
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    const page = await context.newPage();
    session.browser = browser;
    session.context = context;
    session.page = page;

    try {
      // 1. Direct navigation to login page
      this.emitLog(sessionId, 'info', 'جاري فتح منصة SPX Learning Square بمحاكاة متصفح بشري...');
      const loginUrl = 'https://egy.app.spx-learning-square.com/login';
      
      await page.goto(loginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      }).catch(async () => {
        // Fallback navigation if first attempt timed out
        await page.goto(loginUrl, { waitUntil: 'load', timeout: 20000 });
      });

      await this.naturalWait(1500, 2500);

      const currentUrl = page.url();
      const pageTitle = await page.title().catch(() => '');
      const bodySnippet = await page.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => '');

      // Check for AWS CloudFront 403 block
      if (pageTitle.includes('ERROR: The request could not be satisfied') || bodySnippet.includes('403 ERROR')) {
        this.emitLog(
          sessionId,
          'warn',
          'تنبيه: جدار حماية CloudFront للمنصة حظر عنوان السيرفر السحابي. يُنصح بالتشغيل المحلي أو إضافة بروكسي سكني.'
        );
      }

      // Check if already authenticated (e.g. redirected to dashboard/curriculum)
      if (currentUrl.includes('/dashboard') || currentUrl.includes('/curriculum') || currentUrl.includes('/subjects')) {
        this.emitLog(sessionId, 'success', `تم تخطي شاشة الدخول (المستخدم مسجل دخوله بالفعل في: ${currentUrl})...`);
      } else {
        // Locate login fields with resilient multi-selector
        const idField = page.locator('#login-id, input[placeholder*="معرف"], input[type="text"]').first();
        const hasLoginInput = await idField.isVisible({ timeout: 10000 }).catch(() => false);

        if (!hasLoginInput) {
          this.emitLog(
            sessionId,
            'warn',
            `تنبيه في صفحة الدخول: [العنوان: "${pageTitle}" | الرابط: ${currentUrl} | المحتوى: "${bodySnippet.substring(0, 100)}"]`
          );
        }

        this.emitLog(sessionId, 'info', 'تم الوصول إلى صفحة الدخول. جاري إدخال بيانات الطالب بحركة بشرية طبيعية...');
        await this.humanType(page, idField, studentId);

        const passField = page.locator('#password, input[placeholder*="مرور"], input[type="password"]').first();
        await this.humanType(page, passField, password);

        // Secure cleanup: erase password immediately from memory
        password = '';

        await this.naturalWait(600, 1200);

        const submitBtn = page
          .locator('button:has-text("يلا بينا!"), button[type="submit"]:has-text("Let\'s Go!"), button[type="submit"]')
          .first();
        await this.humanClick(page, submitBtn);

        // Wait for login redirection
        await page.waitForURL((url) => !url.href.includes('/login'), { timeout: 20000 }).catch(async () => {
          // Check if error displayed
          const errorText = await page
            .locator('.text-red-500, [role="alert"], div.text-red-600')
            .first()
            .innerText()
            .catch(() => '');
          if (errorText) {
            throw new Error(`فشل تسجيل الدخول بالمنصة: ${errorText}`);
          }
        });
      }

      session.status = 'LOGGED_IN';
      session.progressPercent = 15;
      this.emitLog(sessionId, 'success', 'تم تسجيل الدخول بنجاح! جاري الانتقال إلى المنهج الدراسي...');

      // 2. Navigate to Curriculum with dynamic course detection
      await page.waitForTimeout(2000);
      const postLoginUrl = page.url();
      const postLoginTitle = await page.title().catch(() => '');
      this.emitLog(sessionId, 'info', `الصفحة الحالية بعد تسجيل الدخول: [${postLoginTitle}] (${postLoginUrl})`);

      if (postLoginUrl.includes('/curriculum')) {
        this.emitLog(sessionId, 'info', 'تم الوصول للمنهج الدراسي مباشرة.');
      } else {
        // Inspect available subject links & cards on dashboard
        let targetNavigationUrl = targetUrl;
        let matchedByDashboard = false;

        try {
          const availableLinks = await page.$$eval('a[href*="/subjects/"]', (anchors) =>
            anchors.map((a) => ({
              href: (a as HTMLAnchorElement).href,
              text: (a.textContent || '').trim(),
            }))
          ).catch(() => []);

          if (availableLinks.length > 0) {
            // Match with user's selected course
            const isJs = selectedCourse === 'javascript_ar' || selectedGrade === 'g10';
            const isFin = selectedCourse === 'financial_literacy';
            const isPy = selectedCourse === 'python_short_en';

            const matchedLink = availableLinks.find((l) => {
              const t = l.text.toLowerCase();
              if (isJs && (t.includes('جافا') || t.includes('javascript') || t.includes('كيريو') || t.includes('qureo') || t.includes('برمج'))) return true;
              if (isFin && (t.includes('مالي') || t.includes('financial') || t.includes('ثقاف'))) return true;
              if (isPy && (t.includes('بايثون') || t.includes('python'))) return true;
              return false;
            }) || availableLinks[0];

            if (matchedLink) {
              const baseHref = matchedLink.href.split('?')[0].replace(/\/$/, '');
              targetNavigationUrl = baseHref.endsWith('/curriculum') ? baseHref : `${baseHref}/curriculum`;
              matchedByDashboard = true;
              this.emitLog(sessionId, 'info', `تم العثور على مادة الطالب من لوحة التحكم: "${matchedLink.text}" -> ${targetNavigationUrl}`);
            }
          }
        } catch (_) {}

        if (!matchedByDashboard && postLoginUrl.includes('/subjects/')) {
          targetNavigationUrl = postLoginUrl.endsWith('/curriculum') ? postLoginUrl : `${postLoginUrl.split('?')[0]}/curriculum`;
        }

        this.emitLog(sessionId, 'info', `جاري فتح المنهج الدراسي: ${targetNavigationUrl}...`);
        await page.goto(targetNavigationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(async () => {
          await page.goto(targetNavigationUrl, { waitUntil: 'load', timeout: 20000 });
        });
      }

      session.status = 'EXPLORING';
      session.progressPercent = 25;
      this.emitLog(sessionId, 'info', 'جاري استكشاف المواد والفصول المتاحة للحساب وتوسيع القوائم...');

      // Dynamic Unit & Chapter expansion with resilience loop (checks up to 4 times)
      let discoveredChapters: ChapterItem[] = [];
      for (let attempt = 1; attempt <= 4; attempt++) {
        await page.waitForTimeout(2000);
        await this.ensureCurriculumAccordionsExpanded(page);
        discoveredChapters = await this.discoverCurriculumChapters(page);
        if (discoveredChapters.length > 0) break;
      }

      session.chapters = discoveredChapters;
      session.stats.totalChapters = discoveredChapters.length;

      wsManager.emitChapterUpdate(sessionId, session.chapters, session.stats);
      this.emitLog(sessionId, 'info', `تم اكتشاف ${discoveredChapters.length} فصول ونشاطات دراسية.`);

      // If 0 chapters discovered, inspect page state for diagnosis
      if (discoveredChapters.length === 0) {
        const pageSnippet = await page.evaluate(() => document.body.innerText.substring(0, 250).replace(/\s+/g, ' ')).catch(() => '');
        this.emitLog(sessionId, 'warn', `معاينة محتوى الصفحة: "${pageSnippet}"`);
      }

      // 3. Process Curriculum items sequentially
      let completedLessons = 0;
      session.status = 'SOLVING';

      while (completedLessons < maxLessons && !session.isStopping) {
        if (session.isStopping) break;

        // Ensure we are on the curriculum sidebar view
        await this.returnToCurriculumSidebar(page, sessionId);

        // Ensure accordions are open so next unlocked item is visible
        await this.ensureCurriculumAccordionsExpanded(page);

        // Read real-time progress text (e.g. "3/28 عنصر")
        const progressInfo = await page.evaluate(() => {
          const text = document.body.innerText;
          const match = text.match(/(\d+)\s*\/\s*(\d+)\s*عنصر/);
          if (match) {
            return {
              current: parseInt(match[1], 10),
              total: parseInt(match[2], 10),
            };
          }
          return null;
        });

        if (progressInfo) {
          session.stats.totalChapters = progressInfo.total;
          session.stats.currentChapterIndex = progressInfo.current;
          session.progressPercent = Math.min(
            100,
            Math.round((progressInfo.current / progressInfo.total) * 100)
          );
        }

        // Discover and update chapters in UI
        const discovered = await this.discoverCurriculumChapters(page);
        if (discovered.length > 0) {
          session.chapters = discovered;
          wsManager.emitChapterUpdate(sessionId, session.chapters, session.stats);
        }

        // Methodically find and click the exact next unlocked uncompleted item
        const nextItem = await this.clickNextUnlockedCurriculumItem(page, sessionId);

        if (!nextItem) {
          this.emitLog(sessionId, 'info', 'لم يتم العثور على مزيد من الدروس المفتوحة أو تم إنجاز جميع عناصر المنهج المتاحة.');
          break;
        }

        session.stats.currentChapterIndex = completedLessons + 1;
        wsManager.emitChapterUpdate(sessionId, session.chapters, session.stats);

        // Wait for activity to fully render
        await page.waitForTimeout(3000);

        // Detect whether current screen is Key Points Review OR Interactive Dialogue Lesson
        const isKeyPoints = await page.evaluate(() => {
          const text = document.body.innerText;
          return text.includes('النقاط المهمة') || text.includes('متعلّم');
        });

        if (isKeyPoints) {
          this.emitLog(sessionId, 'info', `[📋] بدء فحص ومراجعة بطاقات "${nextItem.title}"...`);
          await this.solveKeyPointsReview(page, sessionId);
        } else {
          this.emitLog(sessionId, 'info', `[📖] بدء قراءة وحل أسئلة "${nextItem.title}"...`);
          await this.solveInteractiveDialogue(page, sessionId, nextItem.unitTitle);
        }

        completedLessons++;

        // Safely return to curriculum sidebar
        await this.returnToCurriculumSidebar(page, sessionId);

        this.emitLog(
          sessionId,
          'success',
          `تم الانتهاء بنجاح من العنصر (${completedLessons}/${maxLessons}): "${nextItem.title}". جاري فحص الدرس التالي...`
        );

        await page.waitForTimeout(2500);
      }

      if (!session.isStopping) {
        session.status = 'COMPLETED';
        session.progressPercent = 100;
        this.emitLog(sessionId, 'success', 'تهانينا! تم إنجاز خطة المعالجة بنجاح لجميع الفصول المستهدفة.');
      }
    } catch (err: any) {
      if (!session.isStopping) {
        session.status = 'ERROR';
        session.errorMessage = err.message;
        this.emitLog(sessionId, 'error', `حدث خطأ أثناء تنفيذ الجلسة: ${err.message}`);
      }
    } finally {
      try {
        await browser.close().catch(() => {});
      } catch {}
      this.emitLog(sessionId, 'info', 'تم إنهاء جلسة المتصفح المعزولة وحفظ كافة المعرفة المكتسبة.');
    }
  }

  /**
   * Dynamically expands all unit and chapter accordions in the curriculum view.
   * 100% DOM-driven, ZERO hardcoded names.
   */
  private async ensureCurriculumAccordionsExpanded(page: Page): Promise<void> {
    await page.evaluate(() => {
      // Find all collapsed accordion buttons (with chevron-down or downward SVG)
      const buttons = Array.from(
        document.querySelectorAll('button, div[role="button"], div.cursor-pointer, [role="button"]')
      );

      for (const btn of buttons) {
        const text = btn.textContent || '';
        if (text.includes('رجوع') || text.includes('تسجيل خروج') || text.length < 2) continue;

        // Accurate lock detection - NEVER use innerHTML.includes('lock') because it matches CSS 'block'/'inline-block'!
        const isLocked =
          btn.querySelector('.lucide-lock, svg.lock-icon') !== null ||
          btn.classList.contains('cursor-not-allowed') ||
          btn.getAttribute('aria-disabled') === 'true';
        if (isLocked) continue;

        // Check if collapsed
        const isCollapsed =
          btn.querySelector('.lucide-chevron-down') !== null ||
          btn.getAttribute('aria-expanded') === 'false';

        if (isCollapsed) {
          (btn as HTMLElement).click();
        }
      }
    });

    await page.waitForTimeout(1000);

    // If still no lessons are visible, click the first available unit/chapter header
    const rowsCount = await page.evaluate(() => {
      return document.querySelectorAll('.lucide-book-open, .lucide-clipboard-list, .lucide-lock, [role="button"]').length;
    });

    if (rowsCount <= 3) {
      await page.evaluate(() => {
        const firstHeader = Array.from(document.querySelectorAll('button, div.cursor-pointer')).find((b) => {
          const t = b.textContent || '';
          return (
            !t.includes('رجوع') &&
            !t.includes('تسجيل خروج') &&
            t.length > 3 &&
            (b.querySelector('svg') !== null || b.getAttribute('aria-expanded') !== null)
          );
        });
        if (firstHeader) {
          (firstHeader as HTMLElement).click();
        }
      });
      await page.waitForTimeout(1200);
    }
  }

  /**
   * Helper that finds and clicks the first visible unlocked incomplete lesson row
   */
  private async findAndClickVisibleUnlockedItem(
    page: Page
  ): Promise<{ title: string; type: string; unitTitle: string; chapterTitle: string } | null> {
    return await page.evaluate(() => {
      const allRows = Array.from(
        document.querySelectorAll('div.cursor-pointer, button.cursor-pointer, a.cursor-pointer, [role="button"], a')
      );

      // Determine unit title
      let unitTitle = 'الوحدة الدراسية';
      const unitHeader = document.querySelector('h1, h2, h3, .font-bold');
      if (unitHeader && !unitHeader.textContent?.includes('عنصر')) {
        unitTitle = unitHeader.textContent?.trim().split('\n')[0] || unitTitle;
      }

      let currentChapter = '';

      for (const el of allRows) {
        const text = el.textContent?.trim() || '';

        // Skip utility elements
        if (
          text.includes('رجوع') ||
          text.includes('عنصر') ||
          text.includes('الرئيسية') ||
          text.includes('تسجيل خروج') ||
          text.length < 2
        ) {
          continue;
        }

        // Check if element is an Accordion Header (chevron down or up)
        const isAccordionHeader =
          el.querySelector('.lucide-chevron-down, .lucide-chevron-up') !== null ||
          el.getAttribute('aria-expanded') !== null;

        if (isAccordionHeader) {
          currentChapter = text.split('\n')[0].trim();
          continue; // Accordion header is NOT a lesson row!
        }

        // Check if item is already completed (green checkmark badge)
        // Accurate detection: NEVER use innerHTML.includes('check') which matches 'aria-checked="false"' or 'unchecked'!
        const hasCheck =
          el.querySelector('.lucide-check, .lucide-check-circle, .lucide-badge-check, svg.check-icon') !== null ||
          el.querySelector('.text-emerald-500, .text-green-500, .bg-emerald-500, .bg-green-500') !== null ||
          el.classList.contains('text-emerald-500') ||
          el.classList.contains('text-green-500');

        if (hasCheck) {
          continue; // Already solved! Skip to next row.
        }

        // Check if item has lock icon (locked) - NEVER use innerHTML.includes('lock') which matches 'block'!
        const hasLock =
          el.querySelector('.lucide-lock, svg.lock-icon') !== null ||
          el.classList.contains('cursor-not-allowed') ||
          el.getAttribute('aria-disabled') === 'true';

        if (hasLock) {
          continue; // Locked! Cannot be accessed yet.
        }

        // Must be a learning activity (book or clipboard or general activity)
        const isBook =
          el.querySelector('.lucide-book-open, .lucide-book') !== null;
        const isClipboard =
          el.querySelector('.lucide-clipboard-list, .lucide-clipboard, .lucide-file-text') !== null;

        const cleanTitle = text.split('\n')[0].trim();
        if (cleanTitle.length < 2) continue;

        const type = isBook
          ? 'الدرس التفاعلي 📖'
          : isClipboard
          ? 'مراجعة واختبار النقاط المهمة 📋'
          : 'نشاط تدريبي ⚡';

        // Scroll into view and click
        (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
        (el as HTMLElement).click();

        return {
          title: cleanTitle,
          type,
          unitTitle,
          chapterTitle: currentChapter || cleanTitle,
        };
      }

      return null;
    });
  }

  /**
   * Methodically scans the curriculum tree and clicks the exact next unlocked, uncompleted item.
   * Traverses chapters in order:
   * 1. Finds the first visible unlocked incomplete lesson row (📖 or 📋).
   * 2. If no unlocked row is visible (because the current chapter is completed),
   *    finds and expands the NEXT collapsed chapter accordion (chevron-down).
   * 3. Once expanded, clicks the first unlocked incomplete row in that chapter.
   * ZERO hardcoded chapter or lesson names.
   */
  private async clickNextUnlockedCurriculumItem(
    page: Page,
    sessionId: string
  ): Promise<{ title: string; type: string; unitTitle: string; chapterTitle: string } | null> {
    // Attempt 1: Check if an unlocked incomplete item is already visible in an open chapter
    let target = await this.findAndClickVisibleUnlockedItem(page);

    // If not found, a chapter accordion might be collapsed: expand the next collapsed chapter accordion!
    if (!target) {
      const expandedChapter = await page.evaluate(() => {
        // Find all accordion headers with chevron-down (collapsed)
        const buttons = Array.from(
          document.querySelectorAll('div.cursor-pointer, button.cursor-pointer, [role="button"], button')
        );

        for (const btn of buttons) {
          const text = btn.textContent?.trim() || '';
          if (text.includes('رجوع') || text.includes('تسجيل خروج') || text.includes('عنصر') || text.length < 2) {
            continue;
          }

          const hasChevronDown =
            btn.querySelector('.lucide-chevron-down') !== null ||
            btn.innerHTML.includes('chevron-down');
          const isLocked =
            btn.querySelector('.lucide-lock') !== null ||
            btn.classList.contains('opacity-50') ||
            btn.classList.contains('cursor-not-allowed');

          if (hasChevronDown && !isLocked) {
            (btn as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
            (btn as HTMLElement).click();
            return text.split('\n')[0].trim();
          }
        }
        return null;
      });

      if (expandedChapter) {
        this.emitLog(sessionId, 'info', `[توسيع المستوى] تم فتح وتوسيع قائمة: "${expandedChapter}" للوصول للدروس المفتوحة التالية...`);
        await page.waitForTimeout(1500);
        // Attempt 2: Now that chapter is expanded, find and click the unlocked item
        target = await this.findAndClickVisibleUnlockedItem(page);
      }
    }

    if (target) {
      this.emitLog(
        sessionId,
        'info',
        `تم تحديد العنصر النشط التالي بالترتيب: "${target.title}" (${target.type}) - جاري الفتح والحل...`
      );
      await page.waitForTimeout(3000);
    }

    return target;
  }

  /**
   * Safely returns from any activity back to the curriculum sidebar
   * ZERO hardcoded titles.
   */
  private async returnToCurriculumSidebar(page: Page, sessionId: string) {
    const isCurriculum = await page.evaluate(() => {
      return window.location.href.includes('/curriculum');
    });

    if (isCurriculum) return;

    this.emitLog(
      sessionId,
      'info',
      'تم إنهاء النشاط، جاري العودة إلى قائمة المنهج لتحديث علامات الإنجاز والانتقال للعنصر التالي...'
    );

    // 1. Try clicking "رجوع" button
    const backBtn = page.locator('button:has-text("رجوع"), a:has-text("رجوع")').first();
    if (await backBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
      await backBtn.click();
      await page.waitForTimeout(2500);
      return;
    }

    // 2. Direct fallback navigation if needed
    const currentUrl = page.url();
    const baseCurriculumUrl = currentUrl.split('/lessons/')[0].split('/quizzes/')[0];
    const target = baseCurriculumUrl.includes('/curriculum')
      ? baseCurriculumUrl
      : 'https://egy.app.spx-learning-square.com/subjects/7/curriculum';

    await page.goto(target, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(2500);
  }

  /**
   * Discovers and extracts all curriculum chapters and items from the sidebar dynamically
   * ZERO hardcoded names.
   */
  private async discoverCurriculumChapters(page: Page): Promise<ChapterItem[]> {
    await this.ensureCurriculumAccordionsExpanded(page);

    return page.evaluate(() => {
      const items: any[] = [];
      const rows = Array.from(
        document.querySelectorAll('div.cursor-pointer, button.cursor-pointer, a.cursor-pointer, [role="button"], a')
      );

      // Determine unit title dynamically
      let currentUnit = 'الوحدة الدراسية';
      const unitEl = document.querySelector('h1, h2, h3, .font-bold');
      if (unitEl && !unitEl.textContent?.includes('عنصر') && !unitEl.textContent?.includes('رجوع')) {
        currentUnit = unitEl.textContent?.trim().split('\n')[0] || currentUnit;
      }

      let itemIndex = 1;
      for (const el of rows) {
        const text = el.textContent?.trim() || '';

        if (
          text.includes('رجوع') ||
          text.includes('عنصر') ||
          text.includes('الرئيسية') ||
          text.includes('تسجيل خروج') ||
          text.length < 2
        ) {
          continue;
        }

        const isHeader =
          el.querySelector('.lucide-chevron-down, .lucide-chevron-up') !== null ||
          el.getAttribute('aria-expanded') !== null;

        if (isHeader) {
          continue; // Skip accordion headers from item list
        }

        const hasCheck =
          el.querySelector('.lucide-check, .lucide-check-circle, .lucide-badge-check, svg.check-icon') !== null ||
          el.querySelector('.text-emerald-500, .text-green-500, .bg-emerald-500, .bg-green-500') !== null ||
          el.classList.contains('text-emerald-500') ||
          el.classList.contains('text-green-500');

        const hasLock =
          el.querySelector('.lucide-lock, svg.lock-icon') !== null ||
          el.classList.contains('cursor-not-allowed') ||
          el.getAttribute('aria-disabled') === 'true';

        let status: ChapterItem['status'] = 'PENDING';
        if (hasCheck) status = 'COMPLETED';
        else if (!hasLock) status = 'EXPLORING';

        const isBook =
          el.querySelector('.lucide-book-open, .lucide-book') !== null;
        const isClipboard =
          el.querySelector('.lucide-clipboard-list, .lucide-clipboard, .lucide-file-text') !== null;
        const typeSuffix = isBook ? '(درس)' : isClipboard ? '(مراجعة)' : '(نشاط)';

        items.push({
          id: `item-${itemIndex++}`,
          title: `${text.split('\n')[0].trim()} ${typeSuffix}`,
          unitName: currentUnit,
          status,
          progressPercent: hasCheck ? 100 : 0,
        });
      }

      return items;
    });
  }

  /**
   * Solves Interactive Dialogue Lesson with Smart Answer Retrieval & AI Learning
   */
  private async solveInteractiveDialogue(page: Page, sessionId: string, unitTitle: string = 'SPX Curriculum') {
    const session = this.activeSessions.get(sessionId)!;
    let questionIndex = 1;
    let maxQuestions = 15;
    const failedIndices = new Set<number>();

    while (questionIndex <= maxQuestions && !session.isStopping) {
      // Scroll to bottom
      await page.evaluate(() => {
        const scrollable = document.querySelector('main > div.overflow-y-auto, main');
        if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(1200);

      // Check if finished
      const isFinished = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('وصلت للآخر') || text.includes('إكمال') || text.includes('انتهى');
      });

      if (isFinished) {
        this.emitLog(sessionId, 'success', 'وصلت لنهاية الدرس! جاري الضغط على زر الإكمال...');
        const completeBtn = page
          .locator('button:has-text("إكمال"), button:has-text("التالي"), button:has-text("تمام")')
          .first();
        if (await completeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await completeBtn.click();
          await page.waitForTimeout(3000);
        }
        break;
      }

      // Check retry button
      const retryBtn = page.locator('button:has-text("حاول تاني")').first();
      if (await retryBtn.isVisible({ timeout: 800 }).catch(() => false)) {
        this.emitLog(sessionId, 'warn', 'تنبيه: ظهر زر "حاول تاني". جاري استبعاد الخيار وتعديل الإجابة...');
        await retryBtn.click();
        await page.waitForTimeout(1000);
      }

      // Detect active questions
      const activeRadios = page.locator('main [role="radio"]:not([aria-disabled="true"]):not([aria-checked="true"])');
      const activeCount = await activeRadios.count();

      if (activeCount === 0) {
        this.emitLog(sessionId, 'info', 'لا توجد أسئلة نشطة متبقية في الشاشة الحالية.');
        break;
      }

      const options: string[] = [];
      for (let i = 0; i < activeCount; i++) {
        options.push((await activeRadios.nth(i).innerText()).trim());
      }

      session.stats.detectedQuestions++;
      wsManager.emitChapterUpdate(sessionId, session.chapters, session.stats);

      // Extract question prompt from dialogue
      const prompt = await page.evaluate(() => {
        const main = document.querySelector('main');
        const text = main ? main.innerText : document.body.innerText;
        const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 5);
        const candidates = lines.filter((l) => l.includes('؟') || l.includes('اختر') || l.includes('أي مما يلي'));
        return candidates.length > 0 ? candidates[candidates.length - 1] : 'سؤال المنصة التعليمية';
      });

      this.emitLog(sessionId, 'info', `سؤال جديد #${questionIndex}: "${prompt.substring(0, 50)}..." (${options.length} اختيارات)`);

      // 1. SMART ANSWER SERVICE: Lookup in persistent knowledge base first!
      const answerResult = await smartAnswerService.getAnswer(
        {
          questionText: prompt,
          options,
          platformName: 'SPX Learning Square',
          subjectName: unitTitle || 'SPX Curriculum',
        },
        session.studentIdMasked
      );

      if (answerResult.fromKnowledgeBase && answerResult.isVerified) {
        session.stats.retrievedFromMemory++;
        wsManager.emitChapterUpdate(sessionId, session.chapters, session.stats);
        this.emitLog(
          sessionId,
          'success',
          `[ذاكرة المعرفة] تم العثور على إجابة موثقة محفوظة مسبقاً! استرجاع فوري (0 AI calls): "${answerResult.answerText.substring(0, 30)}..."`
        );
      } else {
        this.emitLog(
          sessionId,
          'info',
          `[تحليل AI] سؤال جديد غير موثق. تم استدعاء الذكاء الاصطناعي واقتراح: "${answerResult.answerText.substring(0, 30)}..."`
        );
      }

      // Map answer to option index
      let targetOptionIndex = answerResult.matchedOptionIndex ?? 0;
      if (failedIndices.has(targetOptionIndex)) {
        for (let i = 0; i < options.length; i++) {
          if (!failedIndices.has(i)) {
            targetOptionIndex = i;
            break;
          }
        }
      }

      // Human natural selection
      const selectedRadio = activeRadios.nth(targetOptionIndex);
      await this.humanClick(page, selectedRadio);

      // Natural student thinking pause before submitting
      await this.naturalWait(1200, 2200);

      // Click "راجع إجابتي"
      const submitBtn = page.locator('button:has-text("راجع إجابتي")').last();
      if (await submitBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await this.humanClick(page, submitBtn);
        await this.naturalWait(1200, 1800);
      }

      // Verify platform response feedback
      const feedback = await page.evaluate(() => {
        const t = document.body.innerText;
        if (t.includes('إجابة صحيحة') || t.includes('أحسنت') || t.includes('ممتاز')) return 'CORRECT';
        if (t.includes('مش مظبوطة') || t.includes('حاول تاني') || t.includes('غير صحيحة')) return 'INCORRECT';
        return 'UNKNOWN';
      });

      if (feedback === 'CORRECT') {
        session.stats.savedToKnowledge++;
        wsManager.emitChapterUpdate(sessionId, session.chapters, session.stats);
        this.emitLog(sessionId, 'success', 'تأكيد المنصة: "إجابة صحيحة"! تم توثيق الإجابة في قاعدة المعرفة الدائمة للجميع.');

        await smartAnswerService.confirmVerifiedAnswer(
          { questionText: prompt, options },
          options[targetOptionIndex],
          'PLATFORM_CONFIRMED',
          'تم تأكيد صحة الإجابة فورياً من نظام التقييم بمنصة SPX.'
        );

        failedIndices.clear();
        questionIndex++;
      } else if (feedback === 'INCORRECT') {
        this.emitLog(sessionId, 'warn', 'تأكيد المنصة: "إجابة غير صحيحة". جاري تسجيل الرفض واستبعاد الخيار وتعديل المعرفة.');
        failedIndices.add(targetOptionIndex);

        await smartAnswerService.rejectAnswer(
          { questionText: prompt, options },
          options[targetOptionIndex],
          undefined,
          'تم رفض الإجابة لعدم قبولها في المنصة.'
        );
      } else {
        questionIndex++;
      }

      await page.waitForTimeout(1500);
    }
  }

  /**
   * Solves Key Points Review module (6 cards)
   */
  private async solveKeyPointsReview(page: Page, sessionId: string) {
    let reviewedCount = 0;
    while (reviewedCount < 6) {
      const unreviewedCard = page
        .locator('div.cursor-pointer:has-text("النقاط المهمة"):not(:has-text("تمت المراجعة"))')
        .first();

      if (await unreviewedCard.isVisible({ timeout: 2000 }).catch(() => false)) {
        await unreviewedCard.click();
        await page.waitForTimeout(1000);

        // Click "تأكيد المراجعة"
        const confirmBtn = page.locator('button:has-text("تأكيد المراجعة")').first();
        if (await confirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(1000);
        }

        // Rate confidence if modal appears
        const confidenceBtn = page.locator('button:has-text("واثق"), button:has-text("متوسط")').first();
        if (await confidenceBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await confidenceBtn.click();
          await page.waitForTimeout(1000);
        }

        reviewedCount++;
        this.emitLog(sessionId, 'info', `تم مراجعة وتأكيد بطاقة النقاط المهمة (${reviewedCount}/6).`);
      } else {
        break;
      }
    }

    // Complete module
    const completeBtn = page.locator('button:has-text("إكمال"), button:has-text("تمام")').first();
    if (await completeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await this.humanClick(page, completeBtn);
      await this.naturalWait(1500, 2500);
    }
  }

  /**
   * Human Emulation: Natural keystroke typing with human speed variance
   */
  private async humanType(page: Page, locator: any, text: string) {
    try {
      await locator.click();
      await this.naturalWait(150, 300);
      await locator.fill('');
      await page.waitForTimeout(80);

      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        await page.keyboard.type(char);
        // Human typing cadence: 40ms - 110ms with occasional micro-pauses
        const delay = Math.floor(40 + Math.random() * 70);
        await page.waitForTimeout(delay);
        if (Math.random() < 0.12) {
          await this.naturalWait(120, 260);
        }
      }
      await this.naturalWait(180, 350);
    } catch {
      await locator.fill(text).catch(() => {});
    }
  }

  /**
   * Human Emulation: Smooth mouse movement, realistic hover, and natural click
   */
  private async humanClick(page: Page, locator: any) {
    try {
      const box = await locator.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) {
        const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
        const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);
        await page.mouse.move(targetX, targetY, { steps: 5 + Math.floor(Math.random() * 5) });
        await this.naturalWait(100, 220);
        await page.mouse.down();
        await this.naturalWait(50, 95);
        await page.mouse.up();
      } else {
        await locator.click({ force: true });
      }
    } catch {
      await locator.click({ force: true }).catch(() => {});
    }
    await this.naturalWait(200, 400);
  }

  /**
   * Human Emulation: Natural randomized pause between actions
   */
  private async naturalWait(minMs: number = 800, maxMs: number = 2000): Promise<void> {
    const duration = Math.floor(minMs + Math.random() * (maxMs - minMs));
    await new Promise((resolve) => setTimeout(resolve, duration));
  }
}

export const spxAutomationService = SPXAutomationService.getInstance();
