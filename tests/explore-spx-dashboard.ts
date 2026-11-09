import { chromium } from 'playwright';
import { SPXLearningSquareAdapter } from '../src/browser/adapters';

async function exploreSPXDashboard() {
  console.log('====================================================');
  console.log('  EXPLORING SPX DASHBOARD & ACTIVITIES (HEADED)');
  console.log('====================================================');

  const spxUrl = 'https://egy.app.spx-learning-square.com/';
  const loginId = '463992881';
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

    // Wait until dashboard loads
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    console.log('[+] Successfully on Dashboard:', page.url());

    // Inspect buttons available on the dashboard
    const buttons = await page.$$eval('button, a, [role="button"]', els =>
      els.map(el => ({
        text: el.textContent?.trim(),
        tag: el.tagName,
        className: el.className
      })).filter(b => b.text)
    );
    console.log('[+] Discovered Dashboard Action Buttons:');
    console.log(JSON.stringify(buttons, null, 2));

    // Try clicking on "كمّل" (Continue lesson)
    const continueBtn = page.locator('button:has-text("كمّل"), a:has-text("كمّل")').first();
    if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[+] Clicking "كمّل" button to view inside learning modules...');
      await continueBtn.click();
      await page.waitForTimeout(4000);
      console.log('[+] Current URL after click:', page.url());
      console.log('[+] New Page Text Summary:');
      const lessonText = await page.locator('body').innerText();
      console.log(lessonText.slice(0, 1000));

      // Test Question detection on this page
      const adapter = new SPXLearningSquareAdapter();
      const detectedQuestions = await adapter.detectQuestions(page);
      console.log(`[+] Questions detected on this page: ${detectedQuestions.length}`);
      if (detectedQuestions.length > 0) {
        console.log('[+] Sample Question:', JSON.stringify(detectedQuestions[0], null, 2));
      }
    }

    // Keep open for a moment so you can inspect
    await page.waitForTimeout(6000);
  } catch (err: any) {
    console.error('Error during exploration:', err.message);
  } finally {
    await browser.close();
    console.log('[+] Browser closed cleanly.');
  }
}

exploreSPXDashboard();
