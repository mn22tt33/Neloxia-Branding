import { chromium } from 'playwright';

async function completeLesson() {
  console.log('====================================================');
  console.log('  COMPLETING LESSON 1 ("كيف نشأ المال")');
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
    // 1. Login
    await page.goto('https://egy.app.spx-learning-square.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#login-id').fill(process.env.SPX_STUDENT_ID || '');
    await page.locator('#password').fill(process.env.SPX_STUDENT_PASSWORD || '');
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

    // Scroll to bottom
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const innerMain = mains[mains.length - 1];
      if (innerMain) innerMain.scrollTop = innerMain.scrollHeight;
    });
    await page.waitForTimeout(2000);

    // Check if "حاول تاني" is visible
    const retryBtn = page.locator('button:has-text("حاول تاني")').first();
    if (await retryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[+] Clicking "حاول تاني" (Try again)...');
      await retryBtn.click();
      await page.waitForTimeout(1500);
    }

    // Select Option B: "يعمل المال كوسيط بين طرفي الصفقة"
    console.log('[+] Selecting Option B (كوسيط بين طرفي الصفقة)...');
    const optionB = page.locator('[role="radio"]').filter({ hasText: 'وسيط' }).first();
    await optionB.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await optionB.click();
    console.log('[+] Option B selected!');

    await page.waitForTimeout(1000);

    // Click "راجع إجابتي"
    const submitBtn = page.locator('button:has-text("راجع إجابتي")').last();
    await submitBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await submitBtn.click();
    console.log('[+] Clicked "راجع إجابتي"!');

    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/q2_correct_submitted.png' });
    console.log('[+] Saved tests/q2_correct_submitted.png');

    // Scroll inner main all the way down to reveal the rest of the lesson
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const innerMain = mains[mains.length - 1];
        if (innerMain) innerMain.scrollTop = innerMain.scrollHeight;
      });
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: 'tests/lesson_final_unlocked.png' });
    console.log('[+] Saved tests/lesson_final_unlocked.png');

    // Check for any final buttons (e.g., "التالي", "الانتهاء", "حفظ", "إكمال", navigation arrow, etc.)
    const allButtons = await page.$$eval('button', btns => 
      btns.filter(b => b.offsetParent !== null).map(b => b.textContent?.trim() || '')
    );
    console.log('[+] Visible buttons on page:', allButtons);

    // If there is a next step button (like next lesson or completion)
    const nextBtn = page.locator('button:has-text("التالي"), button:has-text("إكمال"), button:has-text("انتهى"), button:has-text("خروج")').first();
    if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`[+] Clicking finish/next button...`);
      await nextBtn.click();
      await page.waitForTimeout(3000);
    }

    // Go back to curriculum to check updated progress percentage!
    console.log('[+] Navigating back to curriculum to verify updated progress...');
    const backBtn = page.locator('button:has-text("رجوع"), a:has-text("رجوع")').first();
    if (await backBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await backBtn.click();
      await page.waitForTimeout(3000);
    } else {
      await page.goto('https://egy.app.spx-learning-square.com/subjects/7', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: 'tests/updated_progress_dashboard.png' });
    console.log('[+] Saved tests/updated_progress_dashboard.png');

    console.log('[+] Completed! Keeping browser open for 15 seconds...');
    await page.waitForTimeout(15000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
    console.log('[+] Browser closed.');
  }
}

completeLesson();
