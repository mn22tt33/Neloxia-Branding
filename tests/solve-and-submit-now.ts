import { chromium } from 'playwright';

async function solveAndSubmitNow() {
  console.log('====================================================');
  console.log('  SOLVING & SUBMITTING SPX EXERCISE (LIVE)');
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
    console.log('[1] Logging into SPX...');
    await page.goto('https://egy.app.spx-learning-square.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#login-id').fill('470777476');
    await page.locator('#password').fill('cR_fR_2C');
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    console.log('[2] Navigating directly to curriculum...');
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

    await page.locator('button:has-text("دور المال")').first().click();
    await page.waitForTimeout(2000);

    await page.locator('text="كيف نشأ المال"').first().click();
    await page.waitForTimeout(5000);

    console.log('[3] Lesson page loaded. Scrolling to question...');

    // Scroll the main content container to bottom
    await page.evaluate(() => {
      const scrollable = document.querySelector('main.overflow-y-auto') || 
                         document.querySelector('.overflow-y-auto') || 
                         document.querySelector('main');
      if (scrollable) {
        scrollable.scrollTop = scrollable.scrollHeight;
      }
    });
    await page.waitForTimeout(1500);

    // 4. Click option C: [role="radio"] with text "يملك ما تريده"
    console.log('[4] Selecting Option C: "من الصعب أن تجد شخصًا يملك ما تريده ويريد ما تملكه"...');
    const optionC = page.locator('[role="radio"]').filter({ hasText: 'يملك ما تريده' }).first();
    await optionC.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await optionC.click();
    console.log('[+] Option C clicked successfully!');

    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'tests/1_selected.png' });
    console.log('[+] Screenshot saved: tests/1_selected.png');

    // 5. Click "راجع إجابتي"
    console.log('[5] Clicking "راجع إجابتي" (Review / Submit answer)...');
    const submitBtn = page.locator('button:has-text("راجع إجابتي")').first();
    await submitBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await submitBtn.click();
    console.log('[+] Clicked "راجع إجابتي"!');

    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/2_submitted.png' });
    console.log('[+] Screenshot saved: tests/2_submitted.png');

    // 6. Check what happens next: scroll down to see newly unlocked content / next question
    await page.evaluate(() => {
      const scrollable = document.querySelector('main.overflow-y-auto') || 
                         document.querySelector('.overflow-y-auto') || 
                         document.querySelector('main');
      if (scrollable) {
        scrollable.scrollTop = scrollable.scrollHeight;
      }
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/3_next_revealed.png' });
    console.log('[+] Screenshot saved: tests/3_next_revealed.png');

    // Check if there is a "التالي" or "استمر" button
    const continueBtns = page.locator('button:has-text("استمر"), button:has-text("التالي"), button:has-text("متابعة")');
    const cCount = await continueBtns.count();
    console.log(`[+] Found ${cCount} continue/next buttons`);
    if (cCount > 0) {
      const cBtn = continueBtns.first();
      if (await cBtn.isVisible().catch(() => false)) {
        console.log('[+] Clicking continue button...');
        await cBtn.click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'tests/4_after_continue.png' });
      }
    }

    console.log('[+] Keeping browser open for 15 seconds to observe...');
    await page.waitForTimeout(15000);

  } catch (err: any) {
    console.error('Error during solve:', err);
  } finally {
    await browser.close();
    console.log('[+] Browser closed.');
  }
}

solveAndSubmitNow();
