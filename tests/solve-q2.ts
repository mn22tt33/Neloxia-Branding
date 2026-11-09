import { chromium } from 'playwright';
import { aiService } from '../src/ai';

async function solveQuestion2() {
  console.log('====================================================');
  console.log('  SOLVING EXERCISE 2 IN "كيف نشأ المال"');
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

    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await unitBtn.click();
      await page.waitForTimeout(2000);
    }

    await page.locator('button:has-text("دور المال")').first().click();
    await page.waitForTimeout(2000);

    await page.locator('text="كيف نشأ المال"').first().click();
    await page.waitForTimeout(5000);

    // Scroll inner main all the way to the absolute bottom!
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const innerMain = mains[mains.length - 1];
      if (innerMain) {
        innerMain.scrollTop = innerMain.scrollHeight;
      }
    });

    await page.waitForTimeout(2000);

    // Extract Question 2 details
    const q2Data = await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const innerMain = mains[mains.length - 1];
      if (!innerMain) return null;

      // Find all radio options
      const radios = Array.from(innerMain.querySelectorAll('[role="radio"]'));
      // The second exercise options are the latter ones
      const radioTexts = radios.map(r => r.textContent?.trim() || '');

      // Find prompt text
      const fullText = innerMain.innerText;
      return {
        radioCount: radios.length,
        radioTexts,
        fullTextSnippet: fullText.substring(fullText.length - 1500)
      };
    });

    console.log('[+] Q2 Data:', JSON.stringify(q2Data, null, 2));

    await page.screenshot({ path: 'tests/q2_view.png' });
    console.log('[+] Saved tests/q2_view.png');

    // Get the radio buttons for Q2
    const allRadios = page.locator('[role="radio"]');
    const totalRadios = await allRadios.count();
    console.log(`[+] Total radio options on page: ${totalRadios}`);

    // If totalRadios is 8, options 0..3 are Q1, and 4..7 are Q2!
    // Or if Q1 is already solved, totalRadios might be 4!
    const q2Radios = [];
    const startIndex = totalRadios > 4 ? totalRadios - 4 : 0;
    for (let i = startIndex; i < totalRadios; i++) {
      const r = allRadios.nth(i);
      const text = await r.innerText();
      q2Radios.push({ index: i, text });
      console.log(`   Q2 Choice [${i - startIndex + 1}]: "${text}"`);
    }

    // Now let's find the question text for Q2
    const wholePageText = await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      return mains[mains.length - 1]?.innerText || '';
    });
    const lines = wholePageText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
    const q2Candidates = lines.filter(l => l.includes('؟') || l.includes('اختر') || l.includes('وسيط') || l.includes('المال'));
    const q2Prompt = q2Candidates.length > 0 ? q2Candidates[q2Candidates.length - 1] : lines[lines.length - 6];

    console.log('====================================================');
    console.log(`[+] QUESTION 2 PROMPT: "${q2Prompt}"`);
    console.log('====================================================');

    // Solve with AI
    const optionsTexts = q2Radios.map(r => r.text);
    console.log('[+] Requesting AI answer for Question 2...');
    const aiAnswer = await aiService.solveQuestion('student-470777476', {
      questionText: `في درس نشأة المال: ${q2Prompt}`,
      options: optionsTexts
    });

    console.log('====================================================');
    console.log('  🎯 AI SUGGESTED ANSWER FOR QUESTION 2:');
    console.log(`  -> ${aiAnswer.answerText}`);
    console.log('====================================================');

    // Find which radio in Q2 matches best
    let selectedRadioIndex = startIndex;
    for (let i = startIndex; i < totalRadios; i++) {
      const rText = await allRadios.nth(i).innerText();
      // Match by choice letter or text
      if (aiAnswer.answerText && (rText.includes(aiAnswer.answerText) || aiAnswer.answerText.includes(rText.substring(2, 20)))) {
        selectedRadioIndex = i;
        break;
      }
    }

    console.log(`[+] Clicking Radio at index ${selectedRadioIndex}...`);
    const targetRadio = allRadios.nth(selectedRadioIndex);
    await targetRadio.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await targetRadio.click();
    console.log('[+] Target Radio clicked!');

    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'tests/q2_selected.png' });

    // Click "راجع إجابتي" (the last one on page)
    const submitBtns = page.locator('button:has-text("راجع إجابتي")');
    const sCount = await submitBtns.count();
    console.log(`[+] Found ${sCount} "راجع إجابتي" buttons`);
    const finalSubmit = submitBtns.last();
    await finalSubmit.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await finalSubmit.click();
    console.log('[+] Clicked final "راجع إجابتي"!');

    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'tests/q2_submitted.png' });
    console.log('[+] Saved tests/q2_submitted.png');

    // Scroll to see final completion
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const innerMain = mains[mains.length - 1];
      if (innerMain) innerMain.scrollTop = innerMain.scrollHeight;
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/q2_final_view.png' });

    // Check if there is an exit/finish button or completion banner
    const finishBtns = page.locator('button:has-text("انتهى"), button:has-text("إكمال"), button:has-text("التالي"), button:has-text("رجوع")');
    console.log(`[+] Found ${await finishBtns.count()} finish/nav buttons`);

    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
    console.log('[+] Browser closed.');
  }
}

solveQuestion2();
