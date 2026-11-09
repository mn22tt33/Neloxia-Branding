import { chromium } from 'playwright';

async function clickCardsCorrectly() {
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

    // Target the specific 6 card buttons inside main
    const cards = page.locator('main button').filter({ hasText: 'النقاط المهمة' });
    const count = await cards.count();
    console.log(`[+] Found ${count} card buttons inside main.`);

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      
      // Scroll into view using container scroll
      const box = await card.boundingBox();
      if (box) {
        // Click the circle on the card (top-left or center of circle)
        // In the screenshot, the circle is on the left side of the card
        console.log(`[+] Clicking card ${i + 1} at (${box.x + 40}, ${box.y + 40})...`);
        await page.mouse.click(box.x + 40, box.y + 40);
      } else {
        await card.click({ force: true });
      }
      await page.waitForTimeout(600);

      // Check current progress
      const p = await page.evaluate(() => document.querySelector('main')?.innerText.match(/\d\/6/)?.[0] || '');
      console.log(`   Progress now: ${p}`);

      // Scroll container down slightly for next card
      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const inner = mains[mains.length - 1];
        if (inner) inner.scrollTop += 220;
      });
      await page.waitForTimeout(500);
    }

    await page.screenshot({ path: 'tests/cards_status_after_clicks.png' });
    console.log('[+] Saved tests/cards_status_after_clicks.png');

    // Scroll to the absolute bottom of innerMain
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
    await page.waitForTimeout(1000);

    // Click "راجعت كل حاجة"
    const doneBtn = page.locator('button:has-text("راجعت كل حاجة")').first();
    if (await doneBtn.isVisible().catch(() => false)) {
      console.log('[+] Clicking "راجعت كل حاجة"...');
      await doneBtn.click();
      await page.waitForTimeout(4000);
      await page.screenshot({ path: 'tests/after_done_clicked.png' });
      console.log('[+] Saved tests/after_done_clicked.png');
    }

    // Go back to curriculum
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const uBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await uBtn.isVisible().catch(() => false)) await uBtn.click();
    await page.waitForTimeout(1500);

    const lBtn = page.locator('button:has-text("دور المال")').first();
    if (await lBtn.isVisible().catch(() => false)) await lBtn.click();
    await page.waitForTimeout(1500);

    await page.screenshot({ path: 'tests/curriculum_final_state.png' });
    console.log('[+] Saved tests/curriculum_final_state.png');

    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

clickCardsCorrectly();
