const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
      'upgrade-insecure-requests': '1',
    }
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log('Navigating to SPRIX...');
  const res = await page.goto('https://egy.app.spx-learning-square.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('HTTP Status:', res ? res.status() : 'null');
  console.log('Page Title:', await page.title());
  console.log('Page URL:', page.url());

  try {
    await page.waitForSelector('#login-id', { timeout: 15000 });
    console.log('✓ SUCCESS: #login-id found and visible!');
    
    // Test typing
    await page.fill('#login-id', '470777476');
    await page.fill('#password', 'cR_fR_2C');
    console.log('✓ Successfully filled login credentials');

    const submitBtn = page.locator('button:has-text("Let\'s Go!"), button:has-text("يلا بينا!")').first();
    const btnVisible = await submitBtn.isVisible();
    console.log('Is submit button visible?', btnVisible);
  } catch (err) {
    console.log('✗ Failed to find login inputs:', err.message);
    const body = await page.evaluate(() => document.body.innerText.substring(0, 300));
    console.log('Body content:', body);
  }

  await browser.close();
})();
