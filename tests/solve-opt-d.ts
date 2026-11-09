import { chromium } from 'playwright';

async function selectOptionDAndComplete() {
  console.log('[+] Retrying with Option D (الوظائف الثلاث جميعًا)...');

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
    await page.goto('https://egy.app.spx-learning-square.com/', { waitUntil: 'domcontentloaded' });
    await page.locator('#login-id').fill(process.env.SPX_STUDENT_ID || '');
    await page.locator('#password').fill(process.env.SPX_STUDENT_PASSWORD || '');
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Make sure "الوظائف الثلاث للمال" is visible
    let topicBtn = page.locator('text="الوظائف الثلاث للمال"').first();
    if (!(await topicBtn.isVisible({ timeout: 1500 }).catch(() => false))) {
      const lesson1Btn = page.locator('button:has-text("دور المال")').first();
      if (!(await lesson1Btn.isVisible({ timeout: 1500 }).catch(() => false))) {
        const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
        if (await unitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await unitBtn.click();
          await page.waitForTimeout(800);
        }
      }
      if (await lesson1Btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await lesson1Btn.click();
        await page.waitForTimeout(800);
      }
    }

    await topicBtn.waitFor({ state: 'visible', timeout: 8000 });
    await topicBtn.click();
    await page.waitForTimeout(3000);

    // Scroll to bottom
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
    await page.waitForTimeout(800);

    // Click "حاول تاني"
    const retryBtn = page.locator('button:has-text("حاول تاني")').first();
    if (await retryBtn.isVisible().catch(() => false)) {
      console.log('[+] Clicking "حاول تاني"...');
      await retryBtn.click();
      await page.waitForTimeout(600);
    }

    // Click Option D: "الوظائف الثلاث جميعًا"
    console.log('[+] Clicking Option D: "الوظائف الثلاث جميعًا"...');
    const optD = page.locator('[role="radio"]').filter({ hasText: 'الوظائف الثلاث جميعًا' }).first();
    await optD.scrollIntoViewIfNeeded();
    await optD.click();
    await page.waitForTimeout(500);

    // Click "راجع إجابتي"
    console.log('[+] Clicking "راجع إجابتي"...');
    const submitBtn = page.locator('button:has-text("راجع إجابتي")').last();
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();
    await page.waitForTimeout(2500);

    // Scroll to bottom to reveal "إكمال"
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const inner = mains[mains.length - 1];
        if (inner) inner.scrollTop = inner.scrollHeight;
      });
      await page.waitForTimeout(600);
    }

    await page.screenshot({ path: 'tests/lesson2_optD_correct.png' });
    console.log('[+] Saved tests/lesson2_optD_correct.png');

    // Click "إكمال"
    const completeBtn = page.locator('button:has-text("إكمال")').first();
    if (await completeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[+] Clicking "إكمال" button...');
      await completeBtn.click();
      await page.waitForTimeout(3000);
    }

    // Go to subject overview to check progress jump!
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'tests/progress_jump_confirmed.png' });
    console.log('[+] Saved tests/progress_jump_confirmed.png');

    await page.waitForTimeout(5000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

selectOptionDAndComplete();
