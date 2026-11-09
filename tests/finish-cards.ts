import { chromium } from 'playwright';

async function finishRemainingCards() {
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

    // Click cards directly by clicking any unselected circle or by dispatching click
    console.log('[+] Processing all cards in a loop...');
    for (let loop = 0; loop < 10; loop++) {
      const p = await page.evaluate(() => document.querySelector('main')?.innerText.match(/\d\/6/)?.[0] || '');
      console.log(`[+] Current progress: ${p}`);
      if (p === '6/6') {
        console.log('[+] 6/6 reached!');
        break;
      }

      // Find all buttons in innerMain and click the first unclicked one
      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const inner = mains[mains.length - 1];
        if (!inner) return;

        // Find all cards
        const allBtns = Array.from(inner.querySelectorAll('button'));
        for (const b of allBtns) {
          // If the card doesn't have a checkmark icon inside, click it
          const hasCheck = b.querySelector('.lucide-check') || b.querySelector('svg.text-emerald-500') || b.innerHTML.includes('check');
          if (!hasCheck && b.textContent?.includes('النقاط المهمة')) {
            b.scrollIntoView({ block: 'center' });
            b.click();
            break;
          }
        }
      });

      await page.waitForTimeout(1000);
    }

    // Scroll to bottom
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
    await page.waitForTimeout(1500);

    // Click "راجعت كل حاجة"
    const doneBtn = page.locator('button:has-text("راجعت كل حاجة")').first();
    if (await doneBtn.isVisible().catch(() => false)) {
      console.log('[+] Clicking "راجعت كل حاجة"...');
      await doneBtn.click({ force: true });
      await page.waitForTimeout(4000);
      await page.screenshot({ path: 'tests/review_done_screenshot.png' });
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

    await page.screenshot({ path: 'tests/topic2_now_unlocked.png' });
    console.log('[+] Saved tests/topic2_now_unlocked.png');

    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

finishRemainingCards();
