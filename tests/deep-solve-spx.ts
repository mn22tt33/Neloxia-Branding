import { chromium } from 'playwright';
import { SPXLearningSquareAdapter } from '../src/browser/adapters';
import { aiService } from '../src/ai';

async function deepSolveStudentSession() {
  console.log('====================================================');
  console.log('  STARTING QUERO SOLVER DEEP LESSON EXPLORER');
  console.log('====================================================');

  const spxUrl = 'https://egy.app.spx-learning-square.com/';
  const loginId = process.env.SPX_STUDENT_ID || '';
  const password = process.env.SPX_STUDENT_PASSWORD || '';

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
    await page.goto(spxUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#login-id').fill(loginId);
    await page.locator('#password').fill(password);
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    console.log(`[+] Dashboard reached: ${page.url()}`);

    // Click on "ابدأ" to go to subjects
    const startBtn = page.locator('button:has-text("ابدأ")').first();
    await startBtn.click();
    await page.waitForTimeout(3000);
    console.log(`[+] Subject Overview URL: ${page.url()}`);

    // Inspect buttons inside the subject:
    const subjectButtons = await page.$$eval('button, a, [role="button"]', (els) =>
      els.map(el => ({
        text: el.textContent?.trim(),
        tag: el.tagName,
        className: el.className
      })).filter(b => b.text && !b.text.includes('العب'))
    );
    console.log(`[+] Action items on Subject Page:`, subjectButtons);

    // Look for lesson trigger: "ابدأ التعلم" or lesson unit button
    const learnBtn = page.locator('button:has-text("ابدأ التعلم"), a:has-text("ابدأ التعلم")').first();
    if (await learnBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log(`[+] Clicking "ابدأ التعلم" (Start Learning) button...`);
      await learnBtn.click();
      await page.waitForTimeout(4000);
      console.log(`[+] Current Lesson / Exercise URL: ${page.url()}`);

      // Extract Questions using SPX Adapter
      console.log(`[+] Inspecting page for active questions and prompts...`);
      const adapter = new SPXLearningSquareAdapter();
      const detected = await adapter.detectQuestions(page);

      if (detected.length > 0) {
        console.log(`====================================================`);
        console.log(`  QUESTIONS FOUND: ${detected.length}`);
        console.log(`====================================================`);
        for (let i = 0; i < detected.length; i++) {
          const q = detected[i];
          console.log(`\n--- Question #${i + 1} ---`);
          console.log(`Prompt: ${q.text}`);
          console.log(`Options: ${q.options ? q.options.join(' | ') : 'None'}`);

          // Send to AI for solving
          console.log(`[+] Generating AI Suggested Solution...`);
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
        console.log(`[!] Page Content Dump:`);
        const bodyTxt = await page.locator('body').innerText();
        console.log(bodyTxt.slice(0, 1000));
      }
    }

    console.log(`[+] Keeping browser open for 20 seconds so you can see the lesson screen...`);
    await page.waitForTimeout(20000);

  } catch (err: any) {
    console.error(`[X] Error: ${err.message}`);
  } finally {
    await browser.close();
    console.log(`[+] Browser closed.`);
  }
}

deepSolveStudentSession();
