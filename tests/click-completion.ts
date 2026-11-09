import { chromium } from 'playwright';

async function clickCompletionButton() {
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
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) await unitBtn.click();
    await page.waitForTimeout(1500);

    const lesson1Btn = page.locator('button:has-text("دور المال")').first();
    if (await lesson1Btn.isVisible({ timeout: 4000 }).catch(() => false)) await lesson1Btn.click();
    await page.waitForTimeout(1500);

    const allQuizCandidates = page.locator('text="كيف نشأ المال"');
    await allQuizCandidates.last().click();
    await page.waitForTimeout(4000);

    // Scroll to absolute bottom
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
    await page.waitForTimeout(1500);

    // Click all unreviewed cards if any
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const inner = mains[mains.length - 1];
        if (!inner) return;

        const unreviewed = Array.from(inner.querySelectorAll('button')).find(b => 
          !b.textContent?.includes('تمت المراجعة') && 
          (b.textContent?.includes('المقايضة') || b.textContent?.includes('التوافق') || 
           b.textContent?.includes('جوهر') || b.textContent?.includes('الثقة') || 
           b.textContent?.includes('النقود') || b.textContent?.includes('التضخم'))
        );
        if (unreviewed) unreviewed.click();
      });
      await page.waitForTimeout(500);
    }

    // Scroll again to absolute bottom
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
    await page.waitForTimeout(1000);

    // Click the finish buttons at the bottom
    const buttonsAtBottom = await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (!inner) return [];

      const btns = Array.from(inner.querySelectorAll('button'));
      return btns.map((b, idx) => ({
        index: idx,
        text: b.textContent?.trim() || '',
        className: b.className
      }));
    });

    console.log('[+] Buttons at bottom:', JSON.stringify(buttonsAtBottom, null, 2));

    // Click "راجعت كل حاجة" or "تمام!" or whatever finish button exists
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (!inner) return;

      const finishBtn = Array.from(inner.querySelectorAll('button')).find(b => 
        b.textContent?.includes('راجعت كل حاجة') || b.textContent?.includes('تمام') || b.textContent?.includes('إكمال')
      );
      if (finishBtn) {
        finishBtn.scrollIntoView();
        (finishBtn as HTMLElement).click();
      }
    });

    await page.waitForTimeout(3000);

    // Also click any pink button if still there
    const pinkBtn = page.locator('button.press-3d-5, button:has-text("إكمال"), button:has-text("تمام")').last();
    if (await pinkBtn.isVisible().catch(() => false)) {
      console.log('[+] Clicking pink button...');
      await pinkBtn.click();
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: 'tests/fully_finished_quiz.png' });
    console.log('[+] Saved tests/fully_finished_quiz.png');

    // Go to curriculum to check progress
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const uBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await uBtn.isVisible().catch(() => false)) await uBtn.click();
    await page.waitForTimeout(1500);

    const lBtn = page.locator('button:has-text("دور المال")').first();
    if (await lBtn.isVisible().catch(() => false)) await lBtn.click();
    await page.waitForTimeout(1500);

    await page.screenshot({ path: 'tests/curriculum_now_2_items.png' });
    console.log('[+] Saved tests/curriculum_now_2_items.png');

    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

clickCompletionButton();
