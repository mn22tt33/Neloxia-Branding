import { chromium } from 'playwright';

async function finishAll6Cards() {
  console.log('====================================================');
  console.log('  CHECKING ALL 6 CARDS SYSTEMATICALLY');
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

    // Loop until 6/6
    for (let attempt = 0; attempt < 12; attempt++) {
      const p = await page.evaluate(() => document.querySelector('main')?.innerText.match(/\d\/6/)?.[0] || '');
      console.log(`[+] Current card review progress: ${p}`);
      if (p === '6/6') break;

      // Find the first unreviewed card
      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const inner = mains[mains.length - 1];
        if (!inner) return;

        const allCardButtons = Array.from(inner.querySelectorAll('button')).filter(b => 
          (b.textContent?.includes('المقايضة') || b.textContent?.includes('التوافق') || 
           b.textContent?.includes('جوهر') || b.textContent?.includes('الثقة') || 
           b.textContent?.includes('النقود') || b.textContent?.includes('التضخم')) &&
          !b.textContent?.includes('راجعت كل حاجة')
        );

        const unreviewed = allCardButtons.find(b => !b.textContent?.includes('تمت المراجعة'));
        if (unreviewed) {
          unreviewed.scrollIntoView({ block: 'center' });
          unreviewed.click();
        }
      });

      await page.waitForTimeout(1000);
    }

    const finalP = await page.evaluate(() => document.querySelector('main')?.innerText.match(/\d\/6/)?.[0] || '');
    console.log(`[+] Final Progress: ${finalP}`);

    await page.screenshot({ path: 'tests/all_6_done.png' });
    console.log('[+] Saved tests/all_6_done.png');

    // Scroll to bottom and click "راجعت كل حاجة"
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (!inner) return;

      const btn = Array.from(inner.querySelectorAll('button')).find(b => b.textContent?.includes('راجعت كل حاجة'));
      if (btn) {
        btn.scrollIntoView({ block: 'center' });
        (btn as HTMLElement).click();
      }
    });

    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'tests/confirmed_all_6.png' });
    console.log('[+] Saved tests/confirmed_all_6.png');

    // Check if celebration or next screen appears
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 400));
    console.log('[+] Page text after confirm:', pageText.replace(/\n+/g, ' '));

    // Return to curriculum to see the lock unlock!
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const uBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await uBtn.isVisible().catch(() => false)) await uBtn.click();
    await page.waitForTimeout(1500);

    const lBtn = page.locator('button:has-text("دور المال")').first();
    if (await lBtn.isVisible().catch(() => false)) await lBtn.click();
    await page.waitForTimeout(1500);

    await page.screenshot({ path: 'tests/topic2_officially_unlocked.png' });
    console.log('[+] Saved tests/topic2_officially_unlocked.png');

    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

finishAll6Cards();
