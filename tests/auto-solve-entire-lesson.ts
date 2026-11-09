import { chromium } from 'playwright';
import { aiService } from '../src/ai';

async function autoSolveEntireLesson() {
  console.log('====================================================');
  console.log('  AUTO-SOLVING ENTIRE SPX LESSON PROGRESSION');
  console.log('====================================================');

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  const page = await context.newPage();

  try {
    // 1. Login
    await page.goto('https://egy.app.spx-learning-square.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#login-id').fill('470777476');
    await page.locator('#password').fill('cR_fR_2C');
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.locator('button:has-text("ابدأ")').first().click();
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("ابدأ التعلم")').first().click();
    await page.waitForTimeout(3000);

    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await unitBtn.click();
      await page.waitForTimeout(2000);
    }

    await page.locator('button:has-text("دور المال")').first().click();
    await page.waitForTimeout(2000);

    await page.locator('text="كيف نشأ المال"').first().click();
    await page.waitForTimeout(5000);

    console.log('[+] Inside lesson screen. Beginning automated progression loop...');

    let step = 1;
    let maxSteps = 10;

    while (step <= maxSteps) {
      console.log(`\n--- Step ${step}: Inspecting active question ---`);

      // Scroll inner main all the way down
      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const innerMain = mains[mains.length - 1];
        if (innerMain) innerMain.scrollTop = innerMain.scrollHeight;
      });
      await page.waitForTimeout(2000);

      // Check if retry button exists
      const retryBtn = page.locator('button:has-text("حاول تاني")').first();
      if (await retryBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('[+] Found "حاول تاني", clicking it to reset...');
        await retryBtn.click();
        await page.waitForTimeout(1000);
      }

      // Check active "راجع إجابتي" button
      // The active review button is the last one inside innerMain
      const submitButtons = page.locator('button:has-text("راجع إجابتي")');
      const submitCount = await submitButtons.count();

      // Check if there are any unsubmitted questions
      let activeSubmit = null;
      for (let i = submitCount - 1; i >= 0; i--) {
        const btn = submitButtons.nth(i);
        if (await btn.isVisible().catch(() => false)) {
          // Check if it's already answered (look nearby for "إجابة صحيحة")
          activeSubmit = btn;
          break;
        }
      }

      if (!activeSubmit) {
        console.log('[+] No pending "راجع إجابتي" button found! Checking lesson completion...');
        break;
      }

      // Get all radio options in the page
      const allRadios = page.locator('[role="radio"]');
      const totalRadios = await allRadios.count();
      console.log(`[+] Found ${totalRadios} total radio options on page.`);

      if (totalRadios === 0) {
        console.log('[+] No radio options found.');
        break;
      }

      // The active question options are the LAST 4 radio options on screen
      const activeOptionsCount = Math.min(4, totalRadios);
      const startIndex = totalRadios - activeOptionsCount;
      const optionsTexts: string[] = [];

      for (let i = startIndex; i < totalRadios; i++) {
        const t = (await allRadios.nth(i).innerText()).trim();
        optionsTexts.push(t);
      }

      console.log('[+] Active Question Choices:');
      optionsTexts.forEach((opt, idx) => console.log(`   [${idx + 1}] ${opt.substring(0, 70)}...`));

      // Extract question prompt text
      const pageText = await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        return mains[mains.length - 1]?.innerText || '';
      });
      const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
      const candidates = lines.filter(l => l.includes('؟') || l.includes('اختر') || l.includes('أي مما يلي') || l.includes('قيمة'));
      const prompt = candidates.length > 0 ? candidates[candidates.length - 1] : 'سؤال المنصة';

      console.log(`[+] Prompt: "${prompt}"`);

      // AI Solve
      const aiResponse = await aiService.solveQuestion('student-470777476', {
        questionText: prompt,
        options: optionsTexts
      });

      console.log(`[+] AI Answer: ${aiResponse.answerText}`);

      // Click best matching radio
      let targetIndex = startIndex;
      for (let i = startIndex; i < totalRadios; i++) {
        const rText = await allRadios.nth(i).innerText();
        if (aiResponse.answerText && (rText.includes(aiResponse.answerText) || aiResponse.answerText.includes(rText.substring(2, 20)))) {
          targetIndex = i;
          break;
        }
      }

      const targetRadio = allRadios.nth(targetIndex);
      await targetRadio.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await targetRadio.click();
      console.log(`[+] Clicked option at index ${targetIndex}!`);
      await page.waitForTimeout(1000);

      // Submit
      await activeSubmit.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await activeSubmit.click();
      console.log('[+] Clicked "راجع إجابتي"!');
      await page.waitForTimeout(3000);

      // Take screenshot of step result
      await page.screenshot({ path: `tests/step_${step}_result.png` });
      console.log(`[+] Saved tests/step_${step}_result.png`);

      // Scroll again
      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const innerMain = mains[mains.length - 1];
        if (innerMain) innerMain.scrollTop = innerMain.scrollHeight;
      });
      await page.waitForTimeout(2000);

      // Check if end of lesson
      const isEnd = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('أحسنت') || text.includes('اكتمل') || text.includes('تهانينا') || text.includes('التالي');
      });

      step++;
    }

    console.log('[+] Finished all active questions in lesson! Checking curriculum progress...');

    // Go back to curriculum overview
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'tests/final_curriculum_progress.png' });
    console.log('[+] Saved final curriculum screenshot to tests/final_curriculum_progress.png');

    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error('Error during progression:', err);
  } finally {
    await browser.close();
    console.log('[+] Browser closed.');
  }
}

autoSolveEntireLesson();
