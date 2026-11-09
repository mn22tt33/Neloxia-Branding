import { chromium } from 'playwright';
import { aiService } from '../src/ai';

async function actuallySolveExercise() {
  console.log('====================================================');
  console.log('  ACTUALLY SOLVING & SUBMITTING SPX EXERCISE');
  console.log('====================================================');

  const spxUrl = 'https://egy.app.spx-learning-square.com/';
  const loginId = process.env.SPX_STUDENT_ID || '';
  const password = process.env.SPX_STUDENT_PASSWORD || '';

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
    console.log('[1] Logging into SPX...');
    await page.goto(spxUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#login-id').fill(loginId);
    await page.locator('#password').fill(password);
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    console.log('[2] Reached Dashboard. Navigating to curriculum...');

    await page.locator('button:has-text("ابدأ")').first().click();
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("ابدأ التعلم")').first().click();
    await page.waitForTimeout(3000);

    // Expand unit
    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await unitBtn.click();
      await page.waitForTimeout(2000);
    }

    const lessonBtn = page.locator('button:has-text("دور المال")').first();
    await lessonBtn.click();
    await page.waitForTimeout(2000);

    const subTopic = page.locator('text="كيف نشأ المال"').first();
    await subTopic.click();
    await page.waitForTimeout(5000);

    console.log('[3] Lesson page loaded. Scrolling to bottom...');

    // The scrollable container is the content area
    // Let's scroll the scrollable element to the bottom
    await page.evaluate(() => {
      const scrollable = document.querySelector('main.overflow-y-auto') || 
                         document.querySelector('.overflow-y-auto') || 
                         document.documentElement;
      if (scrollable) {
        scrollable.scrollTop = scrollable.scrollHeight;
      }
      window.scrollTo(0, document.body.scrollHeight);
    });

    await page.waitForTimeout(2000);

    // Get all buttons in the document to see what's on screen
    const buttonsInfo = await page.$$eval('button', btns => 
      btns.map((b, i) => ({
        index: i,
        text: b.textContent?.trim() || '',
        visible: b.offsetParent !== null,
        className: b.className
      })).filter(b => b.text.length > 0)
    );

    console.log('[+] Found buttons on page:');
    buttonsInfo.forEach(b => {
      if (b.text.length < 100) {
        console.log(`   - "${b.text}" (visible: ${b.visible})`);
      } else {
        console.log(`   - "${b.text.substring(0, 50)}..." (visible: ${b.visible})`);
      }
    });

    // Take screenshot after scroll
    await page.screenshot({ path: 'tests/scrolled_view.png' });
    console.log('[+] Saved tests/scrolled_view.png');

    // Find the option buttons: buttons containing A, B, C, D
    // Notice in the previous run:
    // [1] Aكان من الصعب حمل الأشياء المراد تبادلها...
    // [2] Bكانت الأشياء تختلف في حجمها...
    // [3] Cمن الصعب أن تجد شخصًا يملك ما تريده ويريد ما تملكه
    // [4] Dكانت الفصول والأحوال المناخية...

    // Find option C button specifically
    const optC = page.locator('button').filter({ hasText: 'C' }).filter({ hasText: 'يملك ما تريده' }).first();
    
    // Also try alternative locator
    const allButtons = page.locator('button');
    const btnCount = await allButtons.count();
    let clickedOption = false;

    for (let i = 0; i < btnCount; i++) {
      const btn = allButtons.nth(i);
      const text = (await btn.innerText().catch(() => '')).trim();
      if (text.startsWith('C') || text.includes('يملك ما تريده ويريد ما تملكه')) {
        console.log(`[4] Found target Option C button: "${text.substring(0, 40)}..."`);
        await btn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);
        await btn.click({ force: true });
        console.log('[+] Successfully clicked Option C!');
        clickedOption = true;
        break;
      }
    }

    if (!clickedOption) {
      console.log('[-] Trying to click using optC locator directly...');
      await optC.scrollIntoViewIfNeeded();
      await optC.click({ force: true });
      console.log('[+] Clicked optC directly');
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/option_selected.png' });
    console.log('[+] Saved tests/option_selected.png');

    // 5. Look for the submit / review button: "راجع إجابتي"
    console.log('[5] Looking for "راجع إجابتي" button...');
    const submitBtn = page.locator('button').filter({ hasText: 'راجع إجابتي' }).first();

    if (await submitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[+] Found "راجع إجابتي" button! Submitting answer...');
      await submitBtn.scrollIntoViewIfNeeded();
      await submitBtn.click({ force: true });
      await page.waitForTimeout(3000);
      console.log('[+] Clicked "راجع إجابتي"!');
    } else {
      console.log('[-] Could not find "راجع إجابتي" directly, searching all buttons...');
      for (let i = 0; i < btnCount; i++) {
        const btn = allButtons.nth(i);
        const text = (await btn.innerText().catch(() => '')).trim();
        if (text.includes('راجع') || text.includes('إجابتي') || text.includes('تحقق') || text.includes('ارسال')) {
          console.log(`[+] Clicking review button: "${text}"`);
          await btn.click({ force: true });
          await page.waitForTimeout(3000);
          break;
        }
      }
    }

    // 6. Inspect result after submitting
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/after_submit.png' });
    console.log('[+] Saved tests/after_submit.png');

    // Look for "التالي" or "استمر" or "إغلاق" or checkmark
    const nextBtn = page.locator('button').filter({ hasText: /التالي|استمر|المتابعة|السؤال التالي/ }).first();
    if (await nextBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      console.log('[+] Found "التالي/استمر" button, clicking to advance...');
      await nextBtn.click({ force: true });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'tests/after_next.png' });
    }

    console.log('[+] Waiting 10 seconds before closing...');
    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error(`[X] Error: ${err.message}`);
  } finally {
    await browser.close();
    console.log('[+] Browser closed.');
  }
}

actuallySolveExercise();
