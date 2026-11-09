import { chromium } from 'playwright';

async function finishLesson2Now() {
  console.log('[+] Finishing Lesson 2 final question...');

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
    await page.locator('#login-id').fill('470777476');
    await page.locator('#password').fill('cR_fR_2C');
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible().catch(() => false)) await unitBtn.click();
    await page.waitForTimeout(400);

    const lesson1Btn = page.locator('button:has-text("دور المال")').first();
    if (await lesson1Btn.isVisible().catch(() => false)) await lesson1Btn.click();
    await page.waitForTimeout(400);

    await page.locator('text="الوظائف الثلاث للمال"').first().click();
    await page.waitForTimeout(3000);

    // Scroll inner main to absolute bottom
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
    await page.waitForTimeout(1000);

    // Click Option A specifically
    console.log('[+] Clicking Option A: "استخدام بعضه فيما تحتاجه الآن"...');
    const optA = page.locator('[role="radio"]').filter({ hasText: 'استخدام بعضه' }).first();
    await optA.scrollIntoViewIfNeeded();
    await optA.click();
    await page.waitForTimeout(800);

    // Click "راجع إجابتي"
    console.log('[+] Clicking "راجع إجابتي"...');
    const submitBtn = page.locator('button:has-text("راجع إجابتي")').last();
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();
    await page.waitForTimeout(3000);

    // Scroll to reveal conclusion and "إكمال"
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const inner = mains[mains.length - 1];
        if (inner) inner.scrollTop = inner.scrollHeight;
      });
      await page.waitForTimeout(800);
    }

    await page.screenshot({ path: 'tests/lesson2_completed_screen.png' });
    console.log('[+] Saved tests/lesson2_completed_screen.png');

    // Click "إكمال"
    const completeBtn = page.locator('button:has-text("إكمال")').first();
    if (await completeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[+] Clicking "إكمال"...');
      await completeBtn.click();
      await page.waitForTimeout(4000);
    }

    // Go to subject dashboard to check percentage jump!
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    await page.screenshot({ path: 'tests/percentage_jump_after_lesson2.png' });
    console.log('[+] Saved tests/percentage_jump_after_lesson2.png');

    await page.waitForTimeout(5000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
    console.log('[+] Browser closed.');
  }
}

finishLesson2Now();
