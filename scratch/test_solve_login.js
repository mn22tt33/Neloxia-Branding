const { chromium } = require('playwright');

(async () => {
  const isHeadless = true;
  const browser = await chromium.launch({
    headless: isHeadless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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

  console.log('Navigating...');
  let response = await page.goto('https://egy.app.spx-learning-square.com/login', { 
    waitUntil: 'domcontentloaded', 
    timeout: 30000 
  });

  const pageTitle = await page.title();
  console.log('Page title:', pageTitle);

  const loginInput = page.locator('#login-id, input[name="loginId"], input[placeholder*="كود"], input[type="text"]').first();
  await loginInput.waitFor({ state: 'visible', timeout: 20000 });
  console.log('Login input ready!');

  await loginInput.fill('470777476');
  const passInput = page.locator('#password, input[type="password"]').first();
  await passInput.fill('cR_fR_2C');

  const submitBtn = page.locator('button:has-text("Let\'s Go!"), button:has-text("يلا بينا!")').first();
  await submitBtn.click();
  console.log('Clicked login button');

  await page.waitForURL((url) => !url.href.includes('/login'), { timeout: 20000 });
  console.log('Successfully logged in! Current URL:', page.url());

  await browser.close();
})();
