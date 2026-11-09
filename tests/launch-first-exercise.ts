import { chromium } from 'playwright';
import { SPXLearningSquareAdapter } from '../src/browser/adapters';
import { aiService } from '../src/ai';

async function launchFirstExercise() {
  console.log('====================================================');
  console.log('  OPENING FIRST LESSON EXERCISE (01 أساسيات المال)');
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
    await page.goto(spxUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#login-id').fill(loginId);
    await page.locator('#password').fill(password);
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.locator('button:has-text("ابدأ")').first().click();
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("ابدأ التعلم")').first().click();
    await page.waitForTimeout(3000);

    // Click on the active unit button "أساسيات المال والتمويل0/28 عنصر"
    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      console.log(`[+] Clicking active unit: "${await unitBtn.innerText()}"`);
      await unitBtn.click();
      await page.waitForTimeout(3000);
    }

    // Inspect main content area for the actual lesson card or activity link
    const mainLinks = await page.$$eval('main a, main button, [role="button"]', els =>
      els.map(e => ({
        text: e.textContent?.trim(),
        tag: e.tagName,
        className: e.className
      })).filter(x => x.text && !x.text.includes('العب'))
    );
    console.log('[+] Available Lesson activities in main area:');
    console.log(JSON.stringify(mainLinks.slice(0, 10), null, 2));

    // Click the first activity or lesson item that appears in main
    const exerciseTrigger = page.locator('main a[href*="lesson"], main a[href*="quiz"], main a[href*="exercise"], main .cursor-pointer, button:has-text("1")').first();
    if (await exerciseTrigger.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log(`[+] Opening first exercise...`);
      await exerciseTrigger.click();
      await page.waitForTimeout(4000);
      console.log(`[+] Active Exercise URL: ${page.url()}`);

      // Detect question
      const adapter = new SPXLearningSquareAdapter();
      const detected = await adapter.detectQuestions(page);
      console.log(`[+] Questions detected: ${detected.length}`);
      if (detected.length > 0) {
        for (const q of detected) {
          console.log('-------------------------------------------');
          console.log('Question:', q.text);
          console.log('Options:', q.options?.join(' | '));
          const ans = await aiService.solveQuestion('student-local', { questionText: q.text, options: q.options });
          console.log('AI Answer:', ans.answerText);
          console.log('-------------------------------------------');
        }
      } else {
        const bodyText = await page.locator('body').innerText();
        console.log('[+] Screen excerpt:');
        console.log(bodyText.slice(0, 800));
      }
    }

    // Keep open so user watches
    await page.waitForTimeout(20000);

  } catch (err: any) {
    console.error(`[X] Error: ${err.message}`);
  } finally {
    await browser.close();
    console.log('[+] Closed.');
  }
}

launchFirstExercise();
