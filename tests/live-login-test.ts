import { chromium } from 'playwright';

async function testLiveLogin() {
  console.log('====================================================');
  console.log('  STARTING LIVE LOGIN TEST ON SPX LEARNING SQUARE');
  console.log('====================================================');

  const spxUrl = 'https://egy.app.spx-learning-square.com/';
  const loginId = '463992881';
  const password = 'H7?6mKhy';

  console.log(`[1] Launching Chromium in Headed Mode (visible window) ...`);
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
    console.log(`[2] Navigating to: ${spxUrl}`);
    await page.goto(spxUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const loginInput = page.locator('#login-id').first();
    await loginInput.waitFor({ state: 'visible', timeout: 10000 });

    console.log(`[3] Typing student credentials...`);
    await loginInput.fill(loginId);
    await page.waitForTimeout(500);

    const passwordInput = page.locator('#password').first();
    await passwordInput.fill(password);
    await page.waitForTimeout(500);

    console.log(`[4] Clicking "Let's Go!" submit button...`);
    const submitBtn = page.locator('button[type="submit"]:has-text("Let\'s Go!")').first();
    await submitBtn.click();

    console.log(`[5] Waiting for response and page transition...`);
    // Wait up to 10 seconds for URL change or dashboard load
    await page.waitForTimeout(6000);

    const currentUrl = page.url();
    const currentTitle = await page.title();
    console.log(`[6] Current URL: ${currentUrl}`);
    console.log(`    Current Title: "${currentTitle}"`);

    // Check for any error messages or alerts on screen
    const alertEl = page.locator('[role="alert"], .text-red-500, .error, .toast').first();
    if (await alertEl.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log(`[!] Alert message detected: "${await alertEl.innerText()}"`);
    }

    // Inspect elements after login
    const pageText = await page.locator('body').innerText();
    console.log(`[7] Page text summary after login:`);
    console.log(pageText.slice(0, 800));

    // Discover post-login navigation links and buttons
    const navItems = await page.$$eval('a, button, [role="button"]', (els) =>
      els.map((e) => e.textContent?.trim()).filter((t): t is string => !!t && t.length > 1).slice(0, 15)
    );
    console.log(`[8] Interactive items found on screen:`, navItems);

    console.log(`[9] Keeping browser window open for 10 seconds so you can see it...`);
    await page.waitForTimeout(10000);

    console.log('====================================================');
    console.log('  LIVE LOGIN TEST COMPLETED SUCCESSFULLY');
    console.log('====================================================');
  } catch (err: any) {
    console.error(`[X] Error during live login test: ${err.message}`);
  } finally {
    await browser.close();
    console.log('[10] Browser closed.');
  }
}

testLiveLogin();
