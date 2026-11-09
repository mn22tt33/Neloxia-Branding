import { chromium } from 'playwright';

async function rapidSolve() {
  console.log('[>>>] RAPID CONTINUOUS SOLVER RUNNING...');

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

    // Open Lesson 2: "الوظائف الثلاث للمال"
    await page.locator('text="الوظائف الثلاث للمال"').first().click();
    await page.waitForTimeout(2000);

    // Scroll to bottom
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
    await page.waitForTimeout(600);

    // Click finish/complete button
    console.log('[+] Looking for complete button in Lesson 2...');
    const clickedFinish = await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (!inner) return false;

      const finishBtn = Array.from(inner.querySelectorAll('button')).find(b => 
        b.textContent?.includes('إكمال') || b.textContent?.includes('وصلت للآخر') || b.textContent?.includes('تمام')
      );
      if (finishBtn) {
        finishBtn.scrollIntoView();
        (finishBtn as HTMLElement).click();
        return true;
      }
      return false;
    });

    console.log(`[+] Clicked finish: ${clickedFinish}`);
    await page.waitForTimeout(2000);

    // Now solve the next topic!
    // Check curriculum
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const uBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await uBtn.isVisible().catch(() => false)) await uBtn.click();
    await page.waitForTimeout(500);

    const lBtn = page.locator('button:has-text("دور المال")').first();
    if (await lBtn.isVisible().catch(() => false)) await lBtn.click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'tests/rapid_curriculum_state.png' });
    console.log('[+] Saved tests/rapid_curriculum_state.png');

    // Return to subjects page to view percentage
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/rapid_percentage.png' });
    console.log('[+] Saved tests/rapid_percentage.png');

    await page.waitForTimeout(4000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

rapidSolve();
