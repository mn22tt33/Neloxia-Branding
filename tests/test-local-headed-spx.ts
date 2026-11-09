import { chromium } from 'playwright';
import { SPXLearningSquareAdapter } from '../src/browser/adapters';

async function testVisibleSPXWorkflow() {
  console.log('====================================================');
  console.log('  STARTING LOCAL HEADED PLAYWRIGHT SPX WORKFLOW TEST');
  console.log('====================================================');

  const spxUrl = 'https://egy.app.spx-learning-square.com/';
  console.log(`[1] Launching Chromium in Headed Mode (headless: false) ...`);

  const browser = await chromium.launch({
    headless: false, // Visible window on Windows desktop
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  const page = await context.newPage();

  try {
    console.log(`[2] Navigating to SPX Portal: ${spxUrl}`);
    await page.goto(spxUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`    Current Title: "${await page.title()}"`);
    console.log(`    Current URL: ${page.url()}`);

    // Wait for the login form to be visible on screen
    const loginInput = page.locator('#login-id').first();
    await loginInput.waitFor({ state: 'visible', timeout: 10000 });
    console.log(`[3] Discovered SPX Login Form on screen!`);

    // Test filling with a placeholder trial username (without submitting fake credentials to avoid locking)
    console.log(`[4] Testing secure DOM field entry (type student code)...`);
    await loginInput.fill('student_trial_demo_code');
    await page.waitForTimeout(1000);

    const passwordInput = page.locator('#password').first();
    await passwordInput.fill('mock_trial_password_123');
    await page.waitForTimeout(1000);
    console.log(`    Input fields filled cleanly without logging credentials.`);

    // Check submit button visibility
    const submitBtn = page.locator('button[type="submit"]:has-text("Let\'s Go!")').first();
    const isBtnVisible = await submitBtn.isVisible();
    console.log(`[5] Submit Button ("Let's Go!") is visible: ${isBtnVisible}`);

    // Clear fields
    await loginInput.fill('');
    await passwordInput.fill('');
    console.log(`[6] Form fields cleared.`);

    // Test Question Detection using the SPX Learning Square Adapter
    console.log(`[7] Testing SPX Learning Square Adapter Question Detector...`);
    const adapter = new SPXLearningSquareAdapter();
    const detected = await adapter.detectQuestions(page);
    console.log(`    Questions extracted on login screen (expected 0/empty): ${detected.length}`);

    await page.waitForTimeout(2000);
    console.log('====================================================');
    console.log('  HEADED TEST COMPLETED SUCCESSFULLY WITH ZERO ERRORS');
    console.log('====================================================');
  } catch (err: any) {
    console.error(`[X] Local Headed Test Error: ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close();
    console.log(`[8] Chromium browser closed cleanly.`);
  }
}

testVisibleSPXWorkflow();
