import { chromium } from 'playwright';

async function checkLesson2Screen() {
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
    await page.goto('https://egy.app.spx-learning-square.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#login-id').fill('470777476');
    await page.locator('#password').fill('cR_fR_2C');
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) await unitBtn.click();
    await page.waitForTimeout(1500);

    const lesson1Btn = page.locator('button:has-text("دور المال")').first();
    if (await lesson1Btn.isVisible({ timeout: 4000 }).catch(() => false)) await lesson1Btn.click();
    await page.waitForTimeout(1500);

    // Open Lesson 2
    const lesson2 = page.locator('text="الوظائف الثلاث للمال"').first();
    await lesson2.click();
    await page.waitForTimeout(5000);

    // Scroll inner main to absolute bottom
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'tests/lesson2_bottom_current.png' });
    console.log('[+] Saved tests/lesson2_bottom_current.png');

    const details = await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (!inner) return null;

      const radios = Array.from(inner.querySelectorAll('[role="radio"]'));
      const buttons = Array.from(inner.querySelectorAll('button'));
      return {
        radioCount: radios.length,
        lastRadios: radios.slice(-4).map(r => r.textContent?.trim() || ''),
        buttons: buttons.map(b => b.textContent?.trim() || ''),
        hasReachedEnd: inner.innerText.includes('وصلت للآخر') || inner.innerText.includes('إكمال')
      };
    });

    console.log('[+] Details:', JSON.stringify(details, null, 2));

    await page.waitForTimeout(8000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

checkLesson2Screen();
