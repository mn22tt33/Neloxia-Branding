import { chromium } from 'playwright';

async function fastSolveNow() {
  console.log('[>>>] HIGH-SPEED SOLVER RUNNING...');

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
    // 1. Login fast
    await page.goto('https://egy.app.spx-learning-square.com/', { waitUntil: 'domcontentloaded' });
    await page.locator('#login-id').fill('470777476');
    await page.locator('#password').fill('cR_fR_2C');
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Expand Unit 01 & Lesson 1
    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible().catch(() => false)) await unitBtn.click();
    await page.waitForTimeout(500);

    const lesson1Btn = page.locator('button:has-text("دور المال")').first();
    if (await lesson1Btn.isVisible().catch(() => false)) await lesson1Btn.click();
    await page.waitForTimeout(500);

    // Open Lesson 2: "الوظائف الثلاث للمال"
    await page.locator('text="الوظائف الثلاث للمال"').first().click();
    await page.waitForTimeout(2500);

    // Scroll to bottom fast
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
    await page.waitForTimeout(800);

    // Click Option A (the last set of radios on screen)
    console.log('[+] Selecting Option A...');
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (!inner) return;

      const radios = Array.from(inner.querySelectorAll('[role="radio"]'));
      // Pick the first option of the last question (Option A)
      const lastFour = radios.slice(-4);
      if (lastFour[0]) {
        lastFour[0].scrollIntoView({ block: 'center' });
        (lastFour[0] as HTMLElement).click();
      }
    });

    await page.waitForTimeout(600);

    // Click "راجع إجابتي"
    console.log('[+] Submitting answer...');
    const submitBtn = page.locator('button:has-text("راجع إجابتي")').last();
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();
    await page.waitForTimeout(1500);

    // Scroll down to complete button
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
    await page.waitForTimeout(1000);

    // Click "إكمال"
    const completeBtn = page.locator('button:has-text("إكمال"), button:has-text("التالي")').last();
    if (await completeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[+] Lesson 2 completed! Clicking "إكمال"...');
      await completeBtn.click();
      await page.waitForTimeout(2500);
    }

    // Now complete the Key Points review for Lesson 2 if opened
    const isKeyPoints = await page.evaluate(() => document.body.innerText.includes('النقاط المهمة'));
    if (isKeyPoints) {
      console.log('[+] Completing Lesson 2 Key Points in turbo mode...');
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => {
          const mains = document.querySelectorAll('main');
          const inner = mains[mains.length - 1];
          if (!inner) return;

          const card = Array.from(inner.querySelectorAll('button')).find(b => 
            !b.textContent?.includes('تمت المراجعة') && !b.textContent?.includes('راجعت كل حاجة')
          );
          if (card) {
            card.scrollIntoView({ block: 'center' });
            card.click();
          }
        });
        await page.waitForTimeout(400);
      }

      // Scroll to bottom and click "راجعت كل حاجة"
      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const inner = mains[mains.length - 1];
        if (inner) inner.scrollTop = inner.scrollHeight;
      });
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const inner = mains[mains.length - 1];
        if (!inner) return;

        const done = Array.from(inner.querySelectorAll('button')).find(b => 
          b.textContent?.includes('راجعت كل حاجة') || b.textContent?.includes('تمام') || b.textContent?.includes('التالي')
        );
        if (done) (done as HTMLElement).click();
      });
      await page.waitForTimeout(2000);

      // Click "التالي"
      const nextBtn = page.locator('button:has-text("التالي")').last();
      if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(2000);
      }
    }

    // Check updated curriculum
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/turbo_progress_update.png' });
    console.log('[+] Finished! Screenshot saved to tests/turbo_progress_update.png');

    await page.waitForTimeout(6000);

  } catch (err: any) {
    console.error('Fast solve error:', err);
  } finally {
    await browser.close();
  }
}

fastSolveNow();
