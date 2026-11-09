import { chromium } from 'playwright';

async function inspectCards() {
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
    await page.locator('#login-id').fill(process.env.SPX_STUDENT_ID || '');
    await page.locator('#password').fill(process.env.SPX_STUDENT_PASSWORD || '');
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await unitBtn.click();
      await page.waitForTimeout(1500);
    }

    const lesson1Btn = page.locator('button:has-text("دور المال")').first();
    if (await lesson1Btn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await lesson1Btn.click();
      await page.waitForTimeout(1500);
    }

    const allQuizCandidates = page.locator('text="كيف نشأ المال"');
    await allQuizCandidates.last().click();
    await page.waitForTimeout(4000);

    // Inspect the cards DOM structure
    const cardsInfo = await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const innerMain = mains[mains.length - 1];
      if (!innerMain) return [];

      // Find all elements that look like cards
      const elements = Array.from(innerMain.querySelectorAll('button, div[role="button"], .cursor-pointer'));
      return elements.map((e, idx) => ({
        index: idx,
        tag: e.tagName,
        className: e.className,
        text: e.textContent?.trim().substring(0, 60),
        rect: e.getBoundingClientRect()
      }));
    });

    console.log('[+] Cards structure:', JSON.stringify(cardsInfo, null, 2));

    // Scroll innerMain down in increments and click any card that is not yet checked
    for (let scrollStep = 0; scrollStep < 5; scrollStep++) {
      console.log(`[+] Scroll step ${scrollStep}...`);

      // Click all visible clickable card circles/buttons in innerMain
      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const innerMain = mains[mains.length - 1];
        if (!innerMain) return;

        // The card elements
        const cards = Array.from(innerMain.querySelectorAll('button, div'));
        cards.forEach(c => {
          const t = c.textContent || '';
          if (t.includes('النقاط المهمة') && (c.tagName === 'BUTTON' || c.getAttribute('role') === 'button')) {
            (c as HTMLElement).click();
          }
        });

        // Also scroll down
        innerMain.scrollTop += 600;
      });

      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: 'tests/cards_scrolled_all.png' });

    // Look for and click "راجعت كل حاجة"
    const doneBtn = page.locator('button:has-text("راجعت كل حاجة")').first();
    if (await doneBtn.isVisible().catch(() => false)) {
      console.log('[+] Found "راجعت كل حاجة"! Clicking...');
      await doneBtn.click({ force: true });
      await page.waitForTimeout(4000);
    }

    await page.screenshot({ path: 'tests/after_reviewed_everything.png' });
    console.log('[+] Saved tests/after_reviewed_everything.png');

    // Return to curriculum to see unlock
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const uBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await uBtn.isVisible().catch(() => false)) await uBtn.click();
    await page.waitForTimeout(1500);

    const lBtn = page.locator('button:has-text("دور المال")').first();
    if (await lBtn.isVisible().catch(() => false)) await lBtn.click();
    await page.waitForTimeout(1500);

    await page.screenshot({ path: 'tests/topic2_unlocked.png' });
    console.log('[+] Saved tests/topic2_unlocked.png');

    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

inspectCards();
