import { chromium } from 'playwright';

async function checkRestOfLesson() {
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

    // Scroll inner main all the way to the bottom!
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const innerMain = mains[mains.length - 1];
      if (innerMain) {
        innerMain.scrollTop = innerMain.scrollHeight;
      }
    });

    await page.waitForTimeout(2000);

    // Take screenshot of the bottom-most view
    await page.screenshot({ path: 'tests/very_bottom.png' });
    console.log('[+] Saved tests/very_bottom.png');

    // Inspect all buttons/clickable elements at the bottom
    const bottomElements = await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const innerMain = mains[mains.length - 1];
      const btns = innerMain ? Array.from(innerMain.querySelectorAll('button, [role="button"], a')) : [];
      return btns.map(b => ({
        tag: b.tagName,
        text: b.textContent?.trim().substring(0, 80),
        className: b.className,
        rect: b.getBoundingClientRect()
      }));
    });

    console.log('[+] Elements in innerMain:', JSON.stringify(bottomElements, null, 2));

    await page.waitForTimeout(5000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

checkRestOfLesson();
