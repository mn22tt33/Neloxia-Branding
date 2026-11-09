import { chromium } from 'playwright';
import { SPXLearningSquareAdapter } from '../src/browser/adapters';
import { aiService } from '../src/ai';

async function launchFirstSubTopic() {
  console.log('====================================================');
  console.log('  OPENING SUB-TOPIC: "كيف نشأ المال"');
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

    // Click on lesson "دور المال"
    const lessonBtn = page.locator('button:has-text("دور المال")').first();
    await lessonBtn.click();
    await page.waitForTimeout(2000);

    // Click on subtopic "كيف نشأ المال"
    console.log('[+] Clicking on subtopic: "كيف نشأ المال" ...');
    const subTopic = page.locator('text="كيف نشأ المال"').first();
    await subTopic.click();
    await page.waitForTimeout(6000);

    console.log('[+] Active Lesson/Question Screen URL:', page.url());

    // Inspect content on the active learning screen
    const screenText = await page.locator('body').innerText();
    console.log('====================================================');
    console.log('  ACTIVE EXERCISE SCREEN CONTENT');
    console.log('====================================================');
    console.log(screenText.slice(0, 1200));

    // Check for interactive quiz choices, radio buttons, or input areas
    const questionChoices = await page.$$eval(
      'main [role="radio"], main label, main button:not(:has-text("رجوع")), .choice-card, .quiz-option',
      els => els.map(el => el.textContent?.trim()).filter(Boolean)
    );
    console.log('[+] Discovered Choices / Action Buttons on Screen:');
    console.log(questionChoices);

    // Keep open so you can interact or see it live
    console.log('[+] Window staying open for 40 seconds for your live test...');
    await page.waitForTimeout(40000);

  } catch (err: any) {
    console.error(`[X] Error: ${err.message}`);
  } finally {
    await browser.close();
    console.log('[+] Closed.');
  }
}

launchFirstSubTopic();
