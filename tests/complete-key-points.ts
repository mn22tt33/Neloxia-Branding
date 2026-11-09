import { chromium } from 'playwright';

async function completeKeyPoints() {
  console.log('====================================================');
  console.log('  COMPLETING KEY POINTS: "كيف نشأ المال"');
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
    await page.locator('#login-id').fill(process.env.SPX_STUDENT_ID || '');
    await page.locator('#password').fill(process.env.SPX_STUDENT_PASSWORD || '');
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Expand unit 01
    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await unitBtn.click();
      await page.waitForTimeout(1500);
    }

    // Expand "دور المال"
    const lesson1Btn = page.locator('button:has-text("دور المال")').first();
    if (await lesson1Btn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await lesson1Btn.click();
      await page.waitForTimeout(1500);
    }

    // Click the quiz / review item (the second "كيف نشأ المال")
    const allQuizCandidates = page.locator('text="كيف نشأ المال"');
    await allQuizCandidates.last().click();
    await page.waitForTimeout(4000);

    console.log('[+] Opened Key Points review screen.');

    // Find and click all checkable card buttons
    const cardButtons = page.locator('button:has-text("النقاط المهمة")');
    const cCount = await cardButtons.count();
    console.log(`[+] Found ${cCount} key point cards.`);

    for (let i = 0; i < cCount; i++) {
      const card = cardButtons.nth(i);
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await card.click();
      console.log(`   [+] Checked card ${i + 1}/${cCount}`);
      await page.waitForTimeout(400);
    }

    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'tests/all_cards_checked.png' });
    console.log('[+] Saved tests/all_cards_checked.png');

    // Click "راجعت كل حاجة"
    console.log('[+] Clicking "راجعت كل حاجة"...');
    const reviewDoneBtn = page.locator('button:has-text("راجعت كل حاجة")').first();
    await reviewDoneBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await reviewDoneBtn.click();
    await page.waitForTimeout(4000);

    await page.screenshot({ path: 'tests/key_points_completed.png' });
    console.log('[+] Saved tests/key_points_completed.png');

    // Check if next lesson is unlocked
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    // Expand unit 01 and "دور المال"
    const uBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await uBtn.isVisible().catch(() => false)) await uBtn.click();
    await page.waitForTimeout(1500);

    const lBtn = page.locator('button:has-text("دور المال")').first();
    if (await lBtn.isVisible().catch(() => false)) await lBtn.click();
    await page.waitForTimeout(1500);

    await page.screenshot({ path: 'tests/curriculum_after_topic1_fully_done.png' });
    console.log('[+] Saved tests/curriculum_after_topic1_fully_done.png');

    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
    console.log('[+] Browser closed.');
  }
}

completeKeyPoints();
