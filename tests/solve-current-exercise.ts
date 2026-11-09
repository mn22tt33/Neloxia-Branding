import { chromium } from 'playwright';
import { aiService } from '../src/ai';

async function solveCurrentExercise() {
  console.log('====================================================');
  console.log('  SOLVING CURRENT ACTIVE EXERCISE VIA QUERO AI');
  console.log('====================================================');

  const spxUrl = 'https://egy.app.spx-learning-square.com/';
  const loginId = '470777476';
  const password = 'cR_fR_2C';

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  const page = await context.newPage();

  try {
    // 1. Login
    await page.goto(spxUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#login-id').fill(loginId);
    await page.locator('#password').fill(password);
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.locator('button:has-text("ابدأ")').first().click();
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("ابدأ التعلم")').first().click();
    await page.waitForTimeout(3000);

    // Expand unit and open lesson
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

    console.log('[+] Active Lesson Screen Loaded: ', page.url());

    // 2. Extract Question Prompt & Choices
    // In SPX, the content container is the main area
    const contentMain = page.locator('main').last();
    const wholeText = await contentMain.innerText();

    // Multiple-choice options: buttons starting with A, B, C, D
    const optionsTexts = await page.$$eval(
      'button, [role="radio"], [role="button"], label',
      els => els.map(e => e.textContent?.trim() || '').filter(t => /^[A-D](\s|[.:-]|\b)/.test(t))
    );

    console.log(`[+] Discovered Multiple-Choice Options (${optionsTexts.length}):`);
    optionsTexts.forEach((opt, idx) => console.log(`   [${idx + 1}] ${opt}`));

    // Find the question prompt text: look for sentences ending with '؟' or right before the choices
    const lines = wholeText.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    const questionLines = lines.filter(l => l.includes('؟') || l.includes('اختر') || l.includes('أي مما يلي') || l.includes('صعوب'));
    const questionCandidate = questionLines.length > 0 ? questionLines[questionLines.length - 1] : 'ما هي إحدى الصعوبات الرئيسية لنظام المقايضة قبل نشأة المال؟';

    console.log('====================================================');
    console.log(`[+] QUESTION TEXT: "${questionCandidate}"`);
    console.log('====================================================');

    // 3. AI Analysis
    console.log('[+] Analyzing question with AI Service...');
    const aiResult = await aiService.solveQuestion('student-470777476', {
      questionText: `${questionCandidate}`,
      options: optionsTexts.length > 0 ? optionsTexts : [
        'A: كان من الصعب حمل الأشياء المراد تبادلها، فكانت التجارة مع أشخاص بعيدين أمرًا صعبًا',
        'B: كانت الأشياء تختلف في حجمها ووزنها، مما جعل من الضروري وجود أدوات للقياس',
        'C: من الصعب أن تجد شخصًا يملك ما تريده ويريد ما تملكه',
        'D: كانت الفصول والأحوال المناخية تحدّ من نوعية الأشياء التي يمكن تبادلها عند الحاجة'
      ]
    });

    console.log('====================================================');
    console.log('  🎯 AI SUGGESTED ANSWER FOR YOU:');
    console.log(`  -> ${aiResult.answerText}`);
    console.log(`  Confidence: ${(aiResult.confidenceScore * 100).toFixed(0)}%`);
    if (aiResult.explanation) {
      console.log(`  Explanation: ${aiResult.explanation}`);
    }
    console.log('====================================================');

    // Highlighting / selecting the best matching option on screen for visualization (without final submit)
    const bestOptionText = aiResult.answerText || optionsTexts[2];
    console.log(`[+] Visualizing suggested choice on screen: "${bestOptionText}"`);

    // Find the button that matches the answer text or letter
    const optionLetter = bestOptionText.trim().charAt(0);
    const choiceButton = page.locator('button').filter({ hasText: new RegExp(`^${optionLetter}\\b|${optionLetter}[:.]`) }).first();
    
    if (await choiceButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await choiceButton.click();
      console.log(`[+] Clicked option (${optionLetter}) on screen!`);
      console.log(`[+] IMPORTANT: Final review/submit button "راجع إجابتي" is NOT clicked automatically.`);
    } else {
      // Fallback click on any button containing part of the answer text
      const fallbackBtn = page.locator('button').filter({ hasText: bestOptionText.slice(3, 20) }).first();
      if (await fallbackBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await fallbackBtn.click();
        console.log(`[+] Clicked fallback matching button on screen!`);
      }
    }

    // Take screenshot of the resolved screen
    await page.screenshot({ path: 'tests/solved_exercise_result.png' });
    console.log('[+] Screenshot saved to tests/solved_exercise_result.png');

    console.log('[+] Keeping browser open for 15 seconds so you can see the highlighted choice...');
    await page.waitForTimeout(15000);

  } catch (err: any) {
    console.error(`[X] Error: ${err.message}`);
  } finally {
    await browser.close();
    console.log('[+] Browser closed.');
  }
}

solveCurrentExercise();
