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

    const isLocalMode = config.browser.mode === 'local' && process.env.NODE_ENV !== 'test';
    const isHeadless = !isLocalMode;

    // Launch Chromium
    const browser = await chromium.launch({
      headless: isHeadless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 850 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      locale: 'ar-EG',
    });

    const page = await context.newPage();
    session.browser = browser;
    session.context = context;
    session.page = page;

    try {
      // 1. Login to SPX Platform
      this.emitLog(sessionId, 'info', 'جاري فتح منصة SPX Learning Square...');
      await page.goto('https://egy.app.spx-learning-square.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      this.emitLog(sessionId, 'info', 'تم الوصول إلى المنصة بنجاح. جاري إدخال بيانات الدخول...');
      await page.locator('#login-id').fill(studentId);
      await page.locator('#password').fill(password);

      // Secure cleanup: erase password immediately from memory
      password = '';

      const submitBtn = page.locator('button[type="submit"]:has-text("Let\'s Go!"), button[type="submit"]');
      await submitBtn.click();

      // Wait for login redirection
      await page.waitForURL('**/dashboard', { timeout: 20000 }).catch(async () => {
        // Check if error displayed
        const errorText = await page
          .locator('.text-red-500, [role="alert"]')
          .first()
          .innerText()
          .catch(() => '');
        if (errorText) {
          throw new Error(`فشل تسجيل الدخول بالمنصة: ${errorText}`);
        }
      });

      session.status = 'LOGGED_IN';
      session.progressPercent = 15;
      this.emitLog(sessionId, 'success', 'تم تسجيل الدخول بنجاح! جاري الانتقال إلى المنهج الدراسي...');

      // 2. Navigate to Curriculum
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      session.status = 'EXPLORING';
      session.progressPercent = 25;
      this.emitLog(sessionId, 'info', 'جاري استكشاف المواد والفصول المتاحة للحساب...');

      // Expand first unit
      const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
      if (await unitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await unitBtn.click().catch(() => {});
        await page.waitForTimeout(1000);
      }

      // Discover chapters
      const discoveredChapters = await this.discoverCurriculumChapters(page);
      session.chapters = discoveredChapters;
      session.stats.totalChapters = discoveredChapters.length;

      wsManager.emitChapterUpdate(sessionId, session.chapters, session.stats);
      this.emitLog(sessionId, 'info', `تم اكتشاف ${discoveredChapters.length} فصول ونشاطات دراسية.`);

      // 3. Process Chapters iteratively
      let completedLessons = 0;
      session.status = 'SOLVING';

      while (completedLessons < maxLessons && !session.isStopping) {
        // Check if session stop requested
        if (session.isStopping) break;

        // Locate next active unlocked chapter
        const nextChapter = session.chapters.find((c) => c.status === 'PENDING' || c.status === 'EXPLORING');
        if (nextChapter) {
          nextChapter.status = 'SOLVING';
          session.stats.currentChapterIndex = completedLessons + 1;
          wsManager.emitChapterUpdate(sessionId, session.chapters, session.stats);
          this.emitLog(sessionId, 'info', `بدء معالجة الفصل: "${nextChapter.title}"...`, {
            chapterName: nextChapter.title,
          });
        }

        // Open topic if on curriculum screen
        const isInsideActivity = await page.evaluate(() => {
          const t = document.body.innerText;
          return (
            t.includes('رجوع') &&
            (t.includes('راجع إجابتي') || t.includes('النقاط المهمة') || t.includes('أجب لعرض البقية'))
          );
        });

        if (!isInsideActivity) {
          await this.openNextUnlockedChapter(page, sessionId);
        }

        // Check activity type: Key Points Review vs Interactive Dialogue Lesson
        const isKeyPoints = await page.evaluate(() => {
          return document.body.innerText.includes('النقاط المهمة') && document.body.innerText.includes('متعلّم');
        });

        if (isKeyPoints) {
          this.emitLog(sessionId, 'info', 'تم اكتشاف وحدة مراجعة "النقاط المهمة"، جاري فحص وتأكيد البطاقات...');
          await this.solveKeyPointsReview(page, sessionId);
        } else {
          this.emitLog(sessionId, 'info', 'تم اكتشاف "درس تفاعلي"، جاري قراءة الأسئلة والمطابقة الذكية...');
          await this.solveInteractiveDialogue(page, sessionId);
        }

        if (nextChapter) {
          nextChapter.status = 'COMPLETED';
          nextChapter.progressPercent = 100;
        }

        completedLessons++;
        session.progressPercent = Math.min(
          95,
          Math.round(25 + (completedLessons / Math.max(1, session.chapters.length)) * 70)
        );
        wsManager.emitChapterUpdate(sessionId, session.chapters, session.stats);
        this.emitLog(sessionId, 'success', `تم إكمال الفصل بنجاح (${completedLessons}/${maxLessons}).`);

        await page.waitForTimeout(3000);
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
   * Discovers and extracts curriculum chapters from DOM
   */
  private async discoverCurriculumChapters(page: Page): Promise<ChapterItem[]> {
    return page.evaluate(() => {
      const items: any[] = [];
      const topicButtons = Array.from(
        document.querySelectorAll('button, div[role="button"], a, .cursor-pointer')
      );

      topicButtons.forEach((btn, index) => {
        const text = btn.textContent?.trim() || '';
        const hasLock = btn.querySelector('.lucide-lock') || btn.innerHTML.includes('lock');
        const hasCheck = btn.querySelector('.lucide-check') || btn.innerHTML.includes('check');

        if (
          text.length > 3 &&
          !text.includes('الشريط') &&
          !text.includes('الرئيسية') &&
          !text.includes('تسجيل خروج') &&
          !text.includes('أساسيات المال والتمويل')
        ) {
          // Determine status
          let status: ChapterItem['status'] = 'PENDING';
          if (hasCheck) status = 'COMPLETED';
          else if (!hasLock) status = 'PENDING';

          items.push({
            id: `chapter-${index + 1}`,
            title: text.split('\n')[0].trim(),
            unitName: 'أساسيات المال والتمويل',
            status,
            progressPercent: hasCheck ? 100 : 0,
          });
        }
      });

      return items.slice(0, 8); // Top relevant chapters
    });
  }

  /**
   * Opens the next unlocked topic in the curriculum
   */
  private async openNextUnlockedChapter(page: Page, sessionId: string) {
    const candidates = ['الوظائف الثلاث للمال', 'أشكال المال الحديث', 'دور المال'];

    for (const name of candidates) {
      const topic = page.locator(`button:has-text("${name}"), div[role="button"]:has-text("${name}")`).first();
      if (await topic.isVisible({ timeout: 1500 }).catch(() => false)) {
        this.emitLog(sessionId, 'info', `جاري فتح الدرس: "${name}"...`);
        await topic.click();
        await page.waitForTimeout(3000);
        return;
      }
    }

    // Fallback: click any unlocked curriculum item
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button, div[role="button"]'));
      for (const el of all) {
        const t = el.textContent || '';
        const hasLock = el.querySelector('.lucide-lock') || el.innerHTML.includes('lock');
        const hasCheck = el.querySelector('.lucide-check') || el.innerHTML.includes('check');
        if (!hasLock && !hasCheck && t.length > 4 && !t.includes('رجوع')) {
          (el as HTMLElement).click();
          break;
        }
      }
    });
    await page.waitForTimeout(3000);
  }

  /**
   * Solves Interactive Dialogue Lesson with Smart Answer Retrieval & AI Learning
   */
  private async solveInteractiveDialogue(page: Page, sessionId: string) {
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
          subjectName: 'أساسيات المال والتمويل',
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
