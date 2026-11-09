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
    options: { subjectUrl?: string; maxLessons?: number }
  ) {
    const session = this.activeSessions.get(sessionId)!;
    const targetUrl = options.subjectUrl || 'https://egy.app.spx-learning-square.com/subjects/7/curriculum';
    const maxLessons = options.maxLessons || 10;

    this.emitLog(sessionId, 'info', 'جاري الاتصال بالسيرفر وإنشاء جلسة متصفح معزولة...');
    this.emitLog(sessionId, 'info', `تم إنشاء جلسة مستقلة للطالب (${session.studentIdMasked}).`);

    const isLinux = process.platform === 'linux';
    const isHeadless = isLinux || config.browser.mode !== 'local' || process.env.NODE_ENV === 'production';

    // Launch Chromium with stealth flags to prevent bot detection
    const browser = await chromium.launch({
      headless: isHeadless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 850 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      locale: 'ar-EG',
      extraHTTPHeaders: {
        'Accept-Language': 'ar-EG,ar;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    // Remove navigator.webdriver automation flag
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    const page = await context.newPage();
    session.browser = browser;
    session.context = context;
    session.page = page;

    try {
      // 1. Direct navigation to login page
      this.emitLog(sessionId, 'info', 'جاري فتح منصة SPX Learning Square...');
      const loginUrl = 'https://egy.app.spx-learning-square.com/login';
      
      await page.goto(loginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      }).catch(async () => {
        // Fallback navigation if first attempt timed out
        await page.goto(loginUrl, { waitUntil: 'load', timeout: 20000 });
      });

      await page.waitForTimeout(2000);

      const currentUrl = page.url();
      const pageTitle = await page.title().catch(() => '');

      // Check if already authenticated (e.g. redirected to dashboard/curriculum)
      if (currentUrl.includes('/dashboard') || currentUrl.includes('/curriculum') || currentUrl.includes('/subjects')) {
        this.emitLog(sessionId, 'success', `تم تخطي شاشة الدخول (المستخدم مسجل دخوله بالفعل في: ${currentUrl})...`);
      } else {
        // Locate login fields with resilient multi-selector
        const idField = page.locator('#login-id, input[placeholder*="معرف"], input[type="text"]').first();
        const hasLoginInput = await idField.isVisible({ timeout: 10000 }).catch(() => false);

        if (!hasLoginInput) {
          const bodySnippet = await page.evaluate(() => document.body.innerText.substring(0, 200)).catch(() => '');
          this.emitLog(
            sessionId,
            'warn',
            `تنبيه في صفحة الدخول: [العنوان: "${pageTitle}" | الرابط: ${currentUrl} | المحتوى: "${bodySnippet}"]`
          );
        }

        this.emitLog(sessionId, 'info', 'تم الوصول إلى صفحة الدخول. جاري إدخال بيانات الطالب...');
        await idField.fill(studentId);

        const passField = page.locator('#password, input[placeholder*="مرور"], input[type="password"]').first();
        await passField.fill(password);

        // Secure cleanup: erase password immediately from memory
        password = '';

        const submitBtn = page
          .locator('button:has-text("يلا بينا!"), button[type="submit"]:has-text("Let\'s Go!"), button[type="submit"]')
          .first();
        await submitBtn.click();

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

      // 2. Navigate to Curriculum
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      session.status = 'EXPLORING';
      session.progressPercent = 25;
      this.emitLog(sessionId, 'info', 'جاري استكشاف المواد والفصول المتاحة للحساب...');

      // Dynamic Unit Entry (100% DOM-driven, zero hardcoded names)
      const currentUnitTitle = await this.ensureInActiveUnit(page, sessionId);

      // Discover chapters
      const discoveredChapters = await this.discoverCurriculumChapters(page);
      session.chapters = discoveredChapters;
      session.stats.totalChapters = discoveredChapters.length;

      wsManager.emitChapterUpdate(sessionId, session.chapters, session.stats);
      this.emitLog(sessionId, 'info', `تم اكتشاف ${discoveredChapters.length} فصول ونشاطات دراسية في "${currentUnitTitle}".`);

      // 3. Process Curriculum items sequentially
      let completedLessons = 0;
      session.status = 'SOLVING';

      while (completedLessons < maxLessons && !session.isStopping) {
        if (session.isStopping) break;

        // Ensure we are on the curriculum sidebar view
        await this.returnToCurriculumSidebar(page, sessionId);

        // Ensure we are inside the active unit
        const activeUnit = await this.ensureInActiveUnit(page, sessionId);

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
          this.emitLog(sessionId, 'info', 'تم فحص جميع عناصر الفصل/الوحدة الحالية. جاري فحص الوحدات التالية...');
          const nextUnit = await this.ensureInActiveUnit(page, sessionId);
          if (!nextUnit || nextUnit === activeUnit) {
            this.emitLog(sessionId, 'info', 'لم يتم العثور على مزيد من الدروس المفتوحة أو تم إنجاز جميع عناصر المنهج المتاحة.');
            break;
          }
          continue;
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
   * Dynamically ensures the browser is inside an active, incomplete unit.
   * If on the curriculum units overview (multiple units with "عنصر"),
   * finds the first unit where completed < total, and clicks it to open its chapters.
   * If inside a unit sidebar where completed === total, clicks "رجوع" to return to units overview
   * and opens the next unlocked unit.
   * ZERO hardcoded unit names.
   */
  private async ensureInActiveUnit(page: Page, sessionId: string): Promise<string> {
    const result = await page.evaluate(() => {
      // Check if we are inside a unit sidebar (has "رجوع" button)
      const backBtn = Array.from(document.querySelectorAll('button, a')).find(
        (b) => b.textContent?.trim().includes('رجوع')
      );

      // Extract current unit progress if present, e.g. "3/28 عنصر"
      const textNodes = Array.from(document.querySelectorAll('*')).filter(
        (el) => el.children.length === 0 && /\d+\s*\/\s*\d+\s*عنصر/.test(el.textContent || '')
      );

      let currentUnitTitle = '';
      let isCurrentUnitComplete = false;

      if (textNodes.length > 0) {
        const match = textNodes[0].textContent!.match(/(\d+)\s*\/\s*(\d+)\s*عنصر/);
        if (match) {
          const cur = parseInt(match[1], 10);
          const tot = parseInt(match[2], 10);
          isCurrentUnitComplete = cur >= tot;

          // Attempt to find unit title from preceding heading or sidebar header
          let p = textNodes[0].parentElement;
          while (p && !currentUnitTitle) {
            const h = p.querySelector('h1, h2, h3, h4, .font-bold, .font-semibold');
            if (h && !h.textContent?.includes('عنصر') && !h.textContent?.includes('رجوع')) {
              currentUnitTitle = h.textContent?.trim().split('\n')[0] || '';
            }
            p = p.parentElement;
          }
        }
      }

      // If we are inside sidebar and current unit is 100% complete, click "رجوع" to exit to units list
      if (backBtn && isCurrentUnitComplete && textNodes.length === 1) {
        (backBtn as HTMLElement).click();
        return { action: 'RETURNED_TO_UNITS', title: currentUnitTitle };
      }

      // If already inside an active incomplete unit sidebar, we are ready!
      if (backBtn && !isCurrentUnitComplete) {
        return { action: 'ALREADY_INSIDE', title: currentUnitTitle || 'الوحدة الحالية' };
      }

      // If on the Units overview page (multiple units listed):
      const unitCards = Array.from(document.querySelectorAll('div, button, a')).filter((el) => {
        const txt = el.textContent || '';
        return (
          txt.includes('عنصر') &&
          (el.querySelector('.lucide-chevron-down, .lucide-chevron-up') !== null ||
            el.innerHTML.includes('chevron'))
        );
      });

      for (const card of unitCards) {
        const txt = card.textContent || '';
        const match = txt.match(/(\d+)\s*\/\s*(\d+)\s*عنصر/);
        if (match) {
          const cur = parseInt(match[1], 10);
          const tot = parseInt(match[2], 10);
          const isComplete = cur >= tot || card.querySelector('.lucide-check-circle, .lucide-check') !== null;
          const isLocked = card.querySelector('.lucide-lock') !== null || card.classList.contains('opacity-50');

          if (!isComplete && !isLocked) {
            const lines = txt.split('\n').map((l) => l.trim()).filter((l) => l.length > 2 && !l.includes('عنصر'));
            const unitTitle = lines[0] || 'الوحدة التالية';
            (card as HTMLElement).click();
            return { action: 'ENTERED_UNIT', title: unitTitle };
          }
        }
      }

      return { action: 'NO_OP', title: currentUnitTitle || 'الوحدة الحالية' };
    });

    if (result.action === 'ENTERED_UNIT') {
      this.emitLog(sessionId, 'info', `[استكشاف المنهج] تم دخول وتفعيل الوحدة: "${result.title}"`);
      await page.waitForTimeout(2000);
    } else if (result.action === 'RETURNED_TO_UNITS') {
      this.emitLog(sessionId, 'success', `[اكتمال الوحدة] تم الانتهاء بنجاح من كافة عناصر: "${result.title}". جاري الانتقال للوحدة التالية...`);
      await page.waitForTimeout(2500);
      return await this.ensureInActiveUnit(page, sessionId);
    }

    return result.title;
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
          el.innerHTML.includes('chevron-down') ||
          el.innerHTML.includes('chevron-up');

        if (isAccordionHeader) {
          currentChapter = text.split('\n')[0].trim();
          continue; // Accordion header is NOT a lesson row!
        }

        // Check if item is already completed (green checkmark badge)
        const hasCheck =
          el.querySelector('.lucide-check, .lucide-check-circle, .lucide-badge-check') !== null ||
          el.innerHTML.includes('check') ||
          el.classList.contains('text-emerald-500') ||
          el.classList.contains('text-green-500');

        if (hasCheck) {
          continue; // Already solved! Skip to next row.
        }

        // Check if item has lock icon (locked)
        const hasLock =
          el.querySelector('.lucide-lock') !== null ||
          el.innerHTML.includes('lock') ||
          el.classList.contains('opacity-50') ||
          el.classList.contains('cursor-not-allowed');

        if (hasLock) {
          continue; // Locked! Cannot be accessed yet.
        }

        // Item must have a learning activity icon (Book or Clipboard) or be a clickable lesson
        const isBook =
          el.querySelector('.lucide-book-open, .lucide-book') !== null || el.innerHTML.includes('book');
        const isClipboard =
          el.querySelector('.lucide-clipboard-list, .lucide-clipboard, .lucide-file-text') !== null ||
          el.innerHTML.includes('clipboard');

        const type = isBook
          ? 'الدرس التفاعلي 📖'
          : isClipboard
          ? 'مراجعة واختبار النقاط المهمة 📋'
          : 'نشاط تعليمي ⚡';

        const cleanTitle = text.split('\n')[0].trim();

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
      const url = window.location.href;
      const isCurriculumUrl = url.includes('/curriculum');
      const hasCurriculumElements =
        document.body.innerText.includes('عنصر') ||
        document.querySelector('.lucide-chevron-down, .lucide-chevron-up, .lucide-book-open, .lucide-clipboard-list') !== null;
      return isCurriculumUrl && hasCurriculumElements;
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
          el.innerHTML.includes('chevron-down') ||
          el.innerHTML.includes('chevron-up');

        if (isHeader) {
          continue; // Skip accordion headers from item list
        }

        const hasCheck =
          el.querySelector('.lucide-check, .lucide-check-circle, .lucide-badge-check') !== null ||
          el.innerHTML.includes('check') ||
          el.classList.contains('text-emerald-500') ||
          el.classList.contains('text-green-500');

        const hasLock =
          el.querySelector('.lucide-lock') !== null ||
          el.innerHTML.includes('lock') ||
          el.classList.contains('opacity-50') ||
          el.classList.contains('cursor-not-allowed');

        let status: ChapterItem['status'] = 'PENDING';
        if (hasCheck) status = 'COMPLETED';
        else if (!hasLock) status = 'EXPLORING';

        const isBook =
          el.querySelector('.lucide-book-open, .lucide-book') !== null || el.innerHTML.includes('book');
        const typeSuffix = isBook ? '(درس)' : '(مراجعة)';

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

      // Click selected option
      const selectedRadio = activeRadios.nth(targetOptionIndex);
      const box = await selectedRadio.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      } else {
        await selectedRadio.click({ force: true });
      }
      await page.waitForTimeout(600);

      // Click "راجع إجابتي"
      const submitBtn = page.locator('button:has-text("راجع إجابتي")').last();
      if (await submitBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(1500);
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
      await completeBtn.click();
      await page.waitForTimeout(2000);
    }
  }
}

export const spxAutomationService = SPXAutomationService.getInstance();
