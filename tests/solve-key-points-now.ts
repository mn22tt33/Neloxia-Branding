import { chromium } from 'playwright';

async function solveKeyPointsNow() {
  console.log('====================================================');
  console.log('  SOLVING KEY POINTS CARDS & CONFIRMING');
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

    const allQuizCandidates = page.locator('text="كيف نشأ المال"');
    await allQuizCandidates.last().click();
    await page.waitForTimeout(4000);

    console.log('[+] Opened Key Points page.');

    // Click cards sequentially
    for (let i = 0; i < 6; i++) {
      console.log(`[+] Clicking card ${i + 1}...`);
      await page.evaluate((index) => {
        const mains = document.querySelectorAll('main');
        const inner = mains[mains.length - 1];
        if (!inner) return;

        const cards = Array.from(inner.querySelectorAll('button')).filter(b => b.textContent?.includes('النقاط المهمة'));
        if (cards[index]) {
          cards[index].scrollIntoView({ block: 'center' });
          cards[index].click();
        }
      }, i);
      await page.waitForTimeout(800);
    }

    const progress = await page.evaluate(() => document.querySelector('main')?.innerText.match(/\d\/6/)?.[0] || '');
    console.log(`[+] Progress reached: ${progress}`);

    // Take screenshot of 6/6
    await page.screenshot({ path: 'tests/key_points_6_of_6.png' });
    console.log('[+] Saved tests/key_points_6_of_6.png');

    // Scroll the "راجعت كل حاجة" button into view
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (!inner) return;

      const btn = Array.from(inner.querySelectorAll('button')).find(b => b.textContent?.includes('راجعت كل حاجة'));
      if (btn) {
        btn.scrollIntoView({ block: 'center' });
      }
    });
    await page.waitForTimeout(1000);

    // Click "راجعت كل حاجة"
    console.log('[+] Clicking "راجعت كل حاجة"...');
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (!inner) return;

      const btn = Array.from(inner.querySelectorAll('button')).find(b => b.textContent?.includes('راجعت كل حاجة'));
      if (btn) {
        (btn as HTMLElement).click();
      }
    });

    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'tests/after_confirming_review.png' });
    console.log('[+] Saved tests/after_confirming_review.png');

    // Inspect what is on the screen now
    const screenText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('[+] Screen text now:', screenText.replace(/\n+/g, ' '));

    // Return to curriculum to observe
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const uBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await uBtn.isVisible().catch(() => false)) await uBtn.click();
    await page.waitForTimeout(1500);

    const lBtn = page.locator('button:has-text("دور المال")').first();
    if (await lBtn.isVisible().catch(() => false)) await lBtn.click();
    await page.waitForTimeout(1500);

    await page.screenshot({ path: 'tests/curriculum_lesson2_unlocked.png' });
    console.log('[+] Saved tests/curriculum_lesson2_unlocked.png');

    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
    console.log('[+] Browser closed.');
  }
}

solveKeyPointsNow();
