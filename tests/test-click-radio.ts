import { chromium } from 'playwright';

async function testClickRadio() {
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

    // Scroll to bottom
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
    await page.waitForTimeout(1000);

    // Find the last 4 radios and inspect their attributes
    const radioInfo = await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (!inner) return [];

      const radios = Array.from(inner.querySelectorAll('[role="radio"]')).slice(-4);
      return radios.map(r => ({
        text: r.textContent?.trim().substring(0, 50),
        ariaChecked: r.getAttribute('aria-checked'),
        ariaDisabled: r.getAttribute('aria-disabled'),
        className: r.className,
        rect: r.getBoundingClientRect()
      }));
    });

    console.log('[+] Last 4 radios:', JSON.stringify(radioInfo, null, 2));

    // Click using mouse.click on the exact coordinates of Option A
    if (radioInfo[0]) {
      const target = radioInfo[0];
      const clickX = target.rect.x + target.rect.width / 2;
      const clickY = target.rect.y + target.rect.height / 2;
      console.log(`[+] Clicking Option A at exact center (${clickX}, ${clickY})...`);
      await page.mouse.click(clickX, clickY);
      await page.waitForTimeout(1000);
    }

    // Check if submit button is enabled now
    const submitState = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const submit = btns.filter(b => b.textContent?.includes('راجع إجابتي')).pop();
      return {
        disabled: submit ? (submit as HTMLButtonElement).disabled : null,
        className: submit?.className
      };
    });

    console.log('[+] Submit button state after click:', submitState);

    await page.screenshot({ path: 'tests/optionA_clicked_verified.png' });
    console.log('[+] Saved tests/optionA_clicked_verified.png');

    // If enabled, click it!
    if (submitState.disabled === false) {
      console.log('[+] Submit button IS ENABLED! Clicking it now...');
      const submitBtn = page.locator('button:has-text("راجع إجابتي")').last();
      await submitBtn.click();
      await page.waitForTimeout(3000);

      // Scroll to completion button
      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const inner = mains[mains.length - 1];
        if (inner) inner.scrollTop = inner.scrollHeight;
      });
      await page.waitForTimeout(1500);

      // Click "إكمال"
      const completeBtn = page.locator('button:has-text("إكمال")').first();
      if (await completeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('[+] Lesson 2 completed! Clicking "إكمال"...');
        await completeBtn.click();
        await page.waitForTimeout(3000);
      }

      await page.screenshot({ path: 'tests/lesson2_officially_complete.png' });
      console.log('[+] Saved tests/lesson2_officially_complete.png');
    }

    // Go to curriculum overview
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/final_percentage_verified.png' });
    console.log('[+] Saved tests/final_percentage_verified.png');

    await page.waitForTimeout(5000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

testClickRadio();
