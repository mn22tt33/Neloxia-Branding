import { chromium } from 'playwright';

async function testChromium() {
  console.log('Testing Chromium launch...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent('<html><body><h1 id="title">Smart Solver Chromium OK</h1></body></html>');
  const text = await page.locator('#title').innerText();
  console.log('RESULT_HEADING:', text);
  await browser.close();
  console.log('Chromium closed cleanly.');
}

testChromium().catch((err) => {
  console.error('Chromium launch failed:', err);
  process.exit(1);
});
