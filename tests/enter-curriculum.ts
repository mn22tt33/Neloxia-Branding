import { chromium } from 'playwright';
import { SPXLearningSquareAdapter } from '../src/browser/adapters';
import { aiService } from '../src/ai';

async function enterCurriculumLesson() {
  console.log('====================================================');
  console.log('  ENTERING FIRST ACTIVE UNFINISHED LESSON ITEM');
  console.log('====================================================');

  const spxUrl = 'https://egy.app.spx-learning-square.com/';
  const loginId = '470777476';
  const password = 'cR_fR_2C';

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  const page = await context.newPage();

  try {
    // 1. Login
    await page.goto(spxUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#login-id').fill(loginId);
    await page.locator('#password').fill(password);
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    // 2. Direct navigate or click into subject curriculum
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    console.log('[+] Dashboard reached!');

    await page.locator('button:has-text("ابدأ")').first().click();
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("ابدأ التعلم")').first().click();
    await page.waitForTimeout(3000);
    console.log('[+] Curriculum page reached:', page.url());

    // 3. Inspect clickable lesson cards / elements in the curriculum tree
    const lessonLinks = await page.$$eval('a, button, [role="button"], .cursor-pointer', els =>
      els.map(el => ({
        text: el.textContent?.trim(),
        tag: el.tagName,
        className: el.className
      })).filter(b => b.text && !b.text.includes('العب'))
    );
    console.log('[+] Clickable items in curriculum:');
    console.log(JSON.stringify(lessonLinks.slice(0, 15), null, 2));

    // 4. Click first topic item (e.g. topic inside 01 أساسيات المال والتمويل)
    const firstLessonItem = page.locator(
      'main a, main .cursor-pointer, button:has-text("ابدأ"), .lesson-item'
    ).nth(1);

    if (await firstLessonItem.isVisible({ timeout: 4000 }).catch(() => false)) {
      console.log(`[+] Clicking lesson topic item: "${await firstLessonItem.innerText()}"`);
      await firstLessonItem.click();
      await page.waitForTimeout(4000);
      console.log(`[+] Active Question / Content URL: ${page.url()}`);

      // Extract & Solve Question
      const adapter = new SPXLearningSquareAdapter();
      const questions = await adapter.detectQuestions(page);
      console.log(`[+] Detected Questions on active screen: ${questions.length}`);

      if (questions.length > 0) {
        for (const q of questions) {
          console.log(`----------------------------------------------------`);
          console.log(`Question: ${q.text}`);
          console.log(`Options: ${q.options?.join(' | ')}`);
          const solution = await aiService.solveQuestion('student-local', {
            questionText: q.text,
            options: q.options,
          });
          console.log(`AI Solution: ${solution.answerText}`);
          console.log(`Confidence: ${(solution.confidenceScore * 100).toFixed(0)}%`);
          console.log(`----------------------------------------------------`);
        }
      }
    }

    console.log('[+] Keeping browser open for 25 seconds for you to watch...');
    await page.waitForTimeout(25000);

  } catch (err: any) {
    console.error(`[X] Error: ${err.message}`);
  } finally {
    await browser.close();
    console.log('[+] Browser closed cleanly.');
  }
}

enterCurriculumLesson();
