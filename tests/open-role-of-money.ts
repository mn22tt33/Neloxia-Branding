import { chromium } from 'playwright';
import { SPXLearningSquareAdapter } from '../src/browser/adapters';
import { aiService } from '../src/ai';

async function openRoleOfMoneyLesson() {
  console.log('====================================================');
  console.log('  OPENING SPECIFIC LESSON: "دور المال" (Role of Money)');
  console.log('====================================================');

  const spxUrl = 'https://egy.app.spx-learning-square.com/';
  const loginId = process.env.SPX_STUDENT_ID || '';
  const password = process.env.SPX_STUDENT_PASSWORD || '';

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
    // Login
    await page.goto(spxUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#login-id').fill(loginId);
    await page.locator('#password').fill(password);
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.locator('button:has-text("ابدأ")').first().click();
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("ابدأ التعلم")').first().click();
    await page.waitForTimeout(3000);

    // Expand unit
    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await unitBtn.click();
      await page.waitForTimeout(2000);
    }

    // Click on lesson "دور المال"
    console.log('[+] Clicking on lesson: "دور المال" ...');
    const lessonBtn = page.locator('button:has-text("دور المال")').first();
    await lessonBtn.click();
    await page.waitForTimeout(5000);

    console.log('[+] Current Lesson URL:', page.url());

    // Inspect the interactive lesson area
    const contentText = await page.locator('body').innerText();
    console.log('[+] Content Summary on Lesson Screen:');
    console.log(contentText.slice(0, 800));

    // Inspect buttons in lesson (e.g. التالي / ابدأ التمرين / السؤال)
    const lessonActions = await page.$$eval('button, a, input[type="radio"], label', els =>
      els.map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim(),
        className: el.className
      })).filter(x => x.text && !x.text.includes('العب'))
    );
    console.log('[+] Interactive elements inside lesson:');
    console.log(JSON.stringify(lessonActions.slice(0, 15), null, 2));

    // Try detecting questions on this active lesson screen
    const adapter = new SPXLearningSquareAdapter();
    const detected = await adapter.detectQuestions(page);
    console.log(`[+] Questions detected by Adapter: ${detected.length}`);

    if (detected.length > 0) {
      for (const q of detected) {
        console.log('----------------------------------------------------');
        console.log(`Question: ${q.text}`);
        console.log(`Options: ${q.options?.join(' | ')}`);
        const solution = await aiService.solveQuestion('student-470777476', {
          questionText: q.text,
          options: q.options,
        });
        console.log(`AI Solution: ${solution.answerText}`);
        console.log('----------------------------------------------------');
      }
    }

    // Keep open so you can view it live
    console.log('[+] Keeping browser open for 30 seconds for your live inspection...');
    await page.waitForTimeout(30000);

  } catch (err: any) {
    console.error(`[X] Error: ${err.message}`);
  } finally {
    await browser.close();
    console.log('[+] Closed.');
  }
}

openRoleOfMoneyLesson();
