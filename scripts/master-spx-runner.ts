import { chromium, Page } from 'playwright';
import { aiService } from '../src/ai';

interface RunnerOptions {
  maxLessonsToSolve?: number;
  headless?: boolean;
}

export class MasterSPXRunner {
  private browser: any;
  private context: any;
  private page!: Page;

  async start(options: RunnerOptions = { maxLessonsToSolve: 5, headless: false }) {
    console.log('====================================================');
    console.log('       SPX LEARNING SQUARE - AUTONOMOUS MASTER SOLVER');
    console.log('====================================================');

    this.browser = await chromium.launch({
      headless: options.headless ?? false,
      args: ['--no-sandbox', '--disable-gpu'],
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      locale: 'en-US',
    });

    this.page = await this.context.newPage();

    try {
      // 1. Login
      console.log('[+] Authenticating student account (470777476)...');
      await this.page.goto('https://egy.app.spx-learning-square.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.locator('#login-id').fill('470777476');
      await this.page.locator('#password').fill('cR_fR_2C');
      await this.page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();
      await this.page.waitForURL('**/dashboard', { timeout: 15000 });

      console.log('[+] Login verified. Navigating to curriculum...');
      await this.page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(3000);

      let lessonsCompleted = 0;
      const targetLessons = options.maxLessonsToSolve || 5;

      while (lessonsCompleted < targetLessons) {
        console.log(`\n====================================================`);
        console.log(`   PROCESSING CURRICULUM ITEM #${lessonsCompleted + 1}/${targetLessons}`);
        console.log(`====================================================`);

        // Check if inside an active lesson or on curriculum view
        const isInsideActivity = await this.page.evaluate(() => {
          return document.body.innerText.includes('رجوع') && 
                 (document.body.innerText.includes('راجع إجابتي') || 
                  document.body.innerText.includes('النقاط المهمة') ||
                  document.body.innerText.includes('أجب لعرض البقية'));
        });

        if (!isInsideActivity) {
          // Open the next available topic
          await this.openNextUnlockedTopic();
        }

        // Detect whether current screen is an Interactive Lesson OR Key Points Review
        const isKeyPoints = await this.page.evaluate(() => {
          return document.body.innerText.includes('النقاط المهمة') && document.body.innerText.includes('متعلّم');
        });

        if (isKeyPoints) {
          console.log('[+] Detected "النقاط المهمة" (Key Points Review) module.');
          await this.solveKeyPointsModule();
        } else {
          console.log('[+] Detected "الدرس التفاعلي" (Interactive Dialogue Lesson).');
          await this.solveInteractiveLesson();
        }

        lessonsCompleted++;
        await this.page.waitForTimeout(3000);
      }

      console.log('\n[🎉] Target lessons reached! Checking curriculum dashboard...');
      await this.page.goto('https://egy.app.spx-learning-square.com/subjects/7', { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(4000);
      await this.page.screenshot({ path: 'tests/master_solver_progress.png' });
      console.log('[+] Screenshot saved to tests/master_solver_progress.png');

    } catch (err: any) {
      console.error('[X] Master Solver Error:', err.message);
    } finally {
      await this.browser.close();
      console.log('[+] Master Solver finished cleanly.');
    }
  }

  private async openNextUnlockedTopic() {
    console.log('[+] Locating next unlocked topic in curriculum...');
    // Ensure Unit 01 is expanded
    const unitBtn = this.page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await unitBtn.click();
      await this.page.waitForTimeout(1000);
    }

    const lesson1Btn = this.page.locator('button:has-text("دور المال")').first();
    if (await lesson1Btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await lesson1Btn.click();
      await this.page.waitForTimeout(1000);
    }

    // Prioritize next unlocked lesson: "الوظائف الثلاث للمال", "أشكال المال الحديث", etc.
    const topicClicked = await this.page.evaluate(() => {
      const candidates = [
        'الوظائف الثلاث للمال',
        'أشكال المال الحديث',
        'دور المال'
      ];

      const allElements = Array.from(document.querySelectorAll('button, div[role="button"], a, .cursor-pointer'));
      for (const name of candidates) {
        const found = allElements.find(el => {
          const t = el.textContent || '';
          const hasLock = el.querySelector('.lucide-lock') || el.innerHTML.includes('lock');
          const hasCheck = el.querySelector('.lucide-check') || el.innerHTML.includes('check');
          return t.includes(name) && !hasLock && !hasCheck;
        });

        if (found) {
          (found as HTMLElement).click();
          return name;
        }
      }

      // Fallback: any unlocked academic element
      for (const el of allElements) {
        const t = el.textContent || '';
        const hasLock = el.querySelector('.lucide-lock') || el.innerHTML.includes('lock');
        const hasCheck = el.querySelector('.lucide-check') || el.innerHTML.includes('check');
        if (!hasLock && !hasCheck && t.length > 3 && !t.includes('470777476') && !t.includes('الشريط')) {
          (el as HTMLElement).click();
          return t;
        }
      }
      return null;
    });

    if (topicClicked) {
      console.log(`[+] Clicked unlocked topic: "${topicClicked.trim()}"`);
      await this.page.waitForTimeout(4000);
    }
  }

  private async solveInteractiveLesson() {
    let questionIndex = 1;
    let maxQuestions = 15;
    let failedIndices = new Set<number>();

    while (questionIndex <= maxQuestions) {
      // Scroll to bottom of active inner main
      await this.scrollInnerToBottom();
      await this.page.waitForTimeout(1500);

      // Check if finished / reached the end
      const isFinished = await this.page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('وصلت للآخر') || text.includes('إكمال') || text.includes('انتهى');
      });

      if (isFinished) {
        console.log('[+] Lesson completed! Clicking completion button...');
        const completeBtn = this.page.locator('button:has-text("إكمال"), button:has-text("التالي"), button:has-text("تمام")').first();
        if (await completeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await completeBtn.click();
          await this.page.waitForTimeout(3000);
        }
        break;
      }

      // Check if retry button exists ("حاول تاني")
      const retryBtn = this.page.locator('button:has-text("حاول تاني")').first();
      if (await retryBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('[!] Detected "حاول تاني". Resetting and eliminating previous failed choice...');
        await retryBtn.click();
        await this.page.waitForTimeout(1000);
      }

      // Extract ONLY active (unanswered and enabled) radios
      const activeRadioLocators = this.page.locator('main [role="radio"]:not([aria-disabled="true"]):not([aria-checked="true"])');
      const activeCount = await activeRadioLocators.count();

      if (activeCount === 0) {
        console.log('[+] No unanswered questions remaining in view.');
        await this.scrollInnerToBottom();
        const finishBtn = this.page.locator('button:has-text("إكمال"), button:has-text("التالي"), button:has-text("تمام")').first();
        if (await finishBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await finishBtn.click();
          await this.page.waitForTimeout(3000);
        }
        break;
      }

      const options: string[] = [];
      for (let i = 0; i < activeCount; i++) {
        options.push((await activeRadioLocators.nth(i).innerText()).trim());
      }

      // Look for the active review button ("راجع إجابتي")
      const submitBtn = this.page.locator('button:has-text("راجع إجابتي")').last();

      // Extract dialogue context & prompt
      const pageDialogue = await this.page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        return mains[mains.length - 1]?.innerText || '';
      });

      console.log(`\n[+] Active Question #${questionIndex}: ${options.length} choices detected`);

      // Filter out previously failed options for this question
      const eligibleIndices: number[] = [];
      for (let i = 0; i < options.length; i++) {
        if (!failedIndices.has(i)) {
          eligibleIndices.push(i);
        }
      }

      if (eligibleIndices.length === 0) {
        console.log('[!] All indices failed, resetting filter...');
        failedIndices.clear();
        for (let i = 0; i < options.length; i++) eligibleIndices.push(i);
      }

      // Extract prompt text
      const lines = pageDialogue.split('\n').map(l => l.trim()).filter(l => l.length > 5);
      const candidates = lines.filter(l => l.includes('؟') || l.includes('اختر') || l.includes('أي مما يلي') || l.includes('ما هو'));
      const prompt = candidates.length > 0 ? candidates[candidates.length - 1] : 'سؤال المنصة التعليمية';

      // 1. Solve using Gemini Flash via aiService
      let aiChosenIndex: number | null = null;
      try {
        const aiResponse = await aiService.solveQuestion('student-470777476', {
          questionText: `سياق الدرس:\n${pageDialogue.slice(-1500)}\n\nالسؤال:\n${prompt}`,
          options: eligibleIndices.map(i => options[i])
        });

        console.log(`[🤖 Gemini Flash] Answer: "${aiResponse.answerText}"`);
        const match = eligibleIndices.find(idx => 
          aiResponse.answerText.includes(options[idx]) || 
          options[idx].includes(aiResponse.answerText) ||
          aiResponse.answerText.startsWith(options[idx].substring(0, 15)) ||
          options[idx].startsWith(aiResponse.answerText.substring(0, 15))
        );
        if (match !== undefined) {
          aiChosenIndex = match;
        }
      } catch (err: any) {
        console.log(`[!] AI Engine Note: ${err.message}`);
      }

      // Best match algorithm using Gemini result OR semantic overlap with dialogue
      let bestIndex = aiChosenIndex !== null ? aiChosenIndex : eligibleIndices[0];
      let highestOverlap = -1;
      const dialogueWords = pageDialogue.split(/\s+/).map(w => w.trim()).filter(w => w.length > 2);

      if (aiChosenIndex === null) {
        for (const i of eligibleIndices) {
          const optText = options[i];
          const optWords = optText.split(/\s+/).filter(w => w.length > 2);
          
          let score = 0;
          for (const w of optWords) {
            if (dialogueWords.includes(w)) score++;
          }

          // Special conceptual matches
          if (optText.includes('كل تصرف يوضّح') || optText.includes('كل تصرف يوضح')) score += 50;
          if (optText.includes('الغالي') && optText.includes('الرخيص')) score += 30;
          if (optText.includes('وسيط بين طرفي') || optText.includes('أداة دفع')) score += 20;

          if (score > highestOverlap) {
            highestOverlap = score;
            bestIndex = i;
          }
        }
      }

      console.log(`[+] Auto-selected choice [${bestIndex + 1}]: "${options[bestIndex].substring(0, 50)}..."`);

      // Click selected option
      const targetRadio = activeRadioLocators.nth(bestIndex);
      await targetRadio.scrollIntoViewIfNeeded();
      await this.page.waitForTimeout(400);
      await targetRadio.click();
      await this.page.waitForTimeout(600);

      // Submit
      if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitBtn.scrollIntoViewIfNeeded();
        await this.page.waitForTimeout(400);
        await submitBtn.click();
        await this.page.waitForTimeout(2500);
      }

      // Verify if correct
      const isCorrect = await this.page.evaluate(() => document.body.innerText.includes('إجابة صحيحة'));
      if (isCorrect) {
        console.log(`[✓] Active Question #${questionIndex} solved correctly!`);
        failedIndices.clear(); // Reset for the next question
        questionIndex++;
      } else {
        console.log(`[!] Option [${bestIndex + 1}] was incorrect, eliminating it for retry.`);
        failedIndices.add(bestIndex);
        // Do not increment questionIndex so it retries this question
      }
    }
  }

  private async solveKeyPointsModule() {
    console.log('[+] Reviewing Key Points cards sequentially...');
    
    // Click cards in a loop until 6/6
    for (let attempt = 0; attempt < 12; attempt++) {
      const p = await this.page.evaluate(() => document.querySelector('main')?.innerText.match(/\d\/6/)?.[0] || '');
      if (p === '6/6') {
        console.log('[✓] All 6 cards reviewed (6/6).');
        break;
      }

      await this.page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const inner = mains[mains.length - 1];
        if (!inner) return;

        const allCardButtons = Array.from(inner.querySelectorAll('button')).filter(b => 
          !b.textContent?.includes('راجعت كل حاجة') && !b.textContent?.includes('تمت المراجعة')
        );

        if (allCardButtons[0]) {
          allCardButtons[0].scrollIntoView({ block: 'center' });
          allCardButtons[0].click();
        }
      });

      await this.page.waitForTimeout(800);
    }

    // Scroll to bottom and click "راجعت كل حاجة"
    await this.scrollInnerToBottom();
    await this.page.waitForTimeout(1000);

    await this.page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (!inner) return;

      const finishBtn = Array.from(inner.querySelectorAll('button')).find(b => 
        b.textContent?.includes('راجعت كل حاجة') || b.textContent?.includes('تمام') || b.textContent?.includes('التالي')
      );
      if (finishBtn) {
        finishBtn.scrollIntoView();
        (finishBtn as HTMLElement).click();
      }
    });

    await this.page.waitForTimeout(3000);

    // Click "التالي"
    const nextBtn = this.page.locator('button:has-text("التالي"), button:has-text("إكمال")').last();
    if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nextBtn.click();
      await this.page.waitForTimeout(3000);
    }
  }

  private async scrollInnerToBottom() {
    await this.page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
  }
}

// Execute
const runner = new MasterSPXRunner();
runner.start({ maxLessonsToSolve: 3, headless: false });
