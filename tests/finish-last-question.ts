import { chromium } from 'playwright';

async function finishLastQuestion() {
  console.log('====================================================');
  console.log('  SUBMITTING FINAL QUESTION & COMPLETING LESSON');
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
    await page.locator('button:has-text("ابدأ")').first().click();
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("ابدأ التعلم")').first().click();
    await page.waitForTimeout(3000);

    // Check if "دور المال" is visible, if not expand "أساسيات المال والتمويل"
    let lessonBtn = page.locator('button:has-text("دور المال")').first();
    if (!(await lessonBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
      const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
      if (await unitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await unitBtn.click();
        await page.waitForTimeout(2000);
      }
    }

    await lessonBtn.waitFor({ state: 'visible', timeout: 10000 });
    await lessonBtn.click();
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

    // Click "حاول تاني" if visible
    const retryBtn = page.locator('button:has-text("حاول تاني")').first();
    if (await retryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[+] Clicking "حاول تاني"...');
      await retryBtn.click();
      await page.waitForTimeout(1500);
    }

    // Select Option D: contains "بالمقايضة كان من الصعب أن تنجح"
    console.log('[+] Selecting Option D (وسيلة تبادل مشتركة)...');
    const optionD = page.locator('[role="radio"]').filter({ hasText: 'وسيلة تبادل مشتركة' }).first();
    await optionD.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await optionD.click();
    console.log('[+] Option D selected!');

    await page.waitForTimeout(1000);

    // Click "راجع إجابتي"
    const submitBtn = page.locator('button:has-text("راجع إجابتي")').last();
    await submitBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await submitBtn.click();
    console.log('[+] Clicked final "راجع إجابتي"!');

    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/final_question_correct.png' });
    console.log('[+] Saved tests/final_question_correct.png');

    // Scroll down to see full conclusion and next buttons
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const innerMain = mains[mains.length - 1];
        if (innerMain) innerMain.scrollTop = innerMain.scrollHeight;
      });
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: 'tests/lesson_conclusion_screen.png' });
    console.log('[+] Saved tests/lesson_conclusion_screen.png');

    // Look for and click any advance/completion button
    const finishBtns = page.locator('button:has-text("التالي"), button:has-text("إكمال"), button:has-text("انتهى"), button:has-text("تم"), button:has-text("متابعة")');
    const fCount = await finishBtns.count();
    console.log(`[+] Found ${fCount} finish/next buttons.`);
    if (fCount > 0) {
      for (let j = 0; j < fCount; j++) {
        const b = finishBtns.nth(j);
        if (await b.isVisible().catch(() => false)) {
          console.log(`[+] Clicking finish button: "${await b.innerText()}"`);
          await b.click();
          await page.waitForTimeout(3000);
          break;
        }
      }
    }

    // Check right sidebar buttons (Lesson 1 vs Lesson 2)
    const sidebarButtons = await page.$$eval('.min-w-0 button, [role="navigation"] button', btns => 
      btns.map(b => b.textContent?.trim() || '')
    );
    console.log('[+] Sidebar navigation elements:', sidebarButtons);

    // Return to curriculum page to capture progress
    console.log('[+] Navigating back to curriculum view...');
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    await page.screenshot({ path: 'tests/curriculum_progress_updated.png' });
    console.log('[+] Saved tests/curriculum_progress_updated.png');

    console.log('[+] Keeping browser open for 15 seconds to observe...');
    await page.waitForTimeout(15000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
    console.log('[+] Browser closed.');
  }
}

finishLastQuestion();
