import { chromium } from 'playwright';
import { SPXLearningSquareAdapter } from '../src/browser/adapters';
import { aiService } from '../src/ai';

async function solveStudentSession() {
  console.log('====================================================');
  console.log('  STARTING QUERO SOLVER FOR NEW STUDENT ACCOUNT');
  console.log('====================================================');

  const spxUrl = 'https://egy.app.spx-learning-square.com/';
  const loginId = process.env.SPX_STUDENT_ID || '';
  const password = process.env.SPX_STUDENT_PASSWORD || '';

  console.log(`[1] Launching Chromium in Visible Mode (Headless: false) ...`);
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
    console.log(`[2] Navigating to SPX: ${spxUrl}`);
    await page.goto(spxUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const loginInput = page.locator('#login-id').first();
    await loginInput.waitFor({ state: 'visible', timeout: 10000 });

    console.log(`[3] Entering Student Credentials...`);
    await loginInput.fill(loginId);
    await page.locator('#password').fill(password);
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    console.log(`[4] Waiting for Dashboard to load...`);
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    console.log(`[+] Dashboard reached: ${page.url()}`);

    await page.waitForTimeout(3000);

    // Inspect dashboard buttons strictly ignoring any games ("العب")
    const actionElements = await page.$$eval('a, button, [role="button"]', (els) =>
      els.map(el => ({
        text: el.textContent?.trim(),
        tag: el.tagName
      })).filter(b => b.text && !b.text.includes('العب'))
    );
    console.log(`[5] Discovered Academic Modules:`, actionElements);

    // Look for lesson start / continue button: "كمّل" or "ابدأ" or similar, NEVER "العب"
    const academicActionBtn = page.locator(
      'button:has-text("كمّل"), a:has-text("كمّل"), button:has-text("ابدأ"), a:has-text("ابدأ"), .lesson-card, .course-card'
    ).first();

    if (await academicActionBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      const btnText = await academicActionBtn.innerText();
      console.log(`[6] Clicking Academic Lesson button: "${btnText}" (Strictly ignoring any games)`);
      await academicActionBtn.click();
      await page.waitForTimeout(4000);
      console.log(`[+] Lesson Page URL: ${page.url()}`);

      // Extract Questions using SPX Adapter
      console.log(`[7] Inspecting and detecting questions...`);
      const adapter = new SPXLearningSquareAdapter();
      const detected = await adapter.detectQuestions(page);

      if (detected.length > 0) {
        console.log(`====================================================`);
        console.log(`  QUESTION DETECTED! (${detected.length} question(s) found)`);
        console.log(`====================================================`);
        for (let i = 0; i < detected.length; i++) {
          const q = detected[i];
          console.log(`\n--- Question #${i + 1} ---`);
          console.log(`Text: ${q.text}`);
          console.log(`Type: ${q.type}`);
          console.log(`Options: ${q.options ? q.options.join(' | ') : 'None'}`);

          // Send to AI for solving
          console.log(`[+] Passing to AI Solver...`);
          const solution = await aiService.solveQuestion(
            'student-session-local',
            {
              questionText: q.text,
              options: q.options,
            }
          );

          console.log(`====================================================`);
          console.log(`  AI SUGGESTED ANSWER:`);
          console.log(`  -> ${solution.answerText}`);
          console.log(`  Confidence: ${(solution.confidenceScore * 100).toFixed(0)}%`);
          if (solution.explanation) console.log(`  Explanation: ${solution.explanation}`);
          console.log(`====================================================`);
        }
      } else {
        console.log(`[!] No immediate question card on this view. Summary text:`);
        const summary = await page.locator('body').innerText();
        console.log(summary.slice(0, 1000));
      }
    }

    console.log(`[8] Keeping window open for 30 seconds for your review...`);
    await page.waitForTimeout(30000);

  } catch (err: any) {
    console.error(`[X] Error during solving workflow: ${err.message}`);
  } finally {
    await browser.close();
    console.log(`[+] Browser closed cleanly.`);
  }
}

solveStudentSession();
