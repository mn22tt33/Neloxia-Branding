import { chromium } from 'playwright';

async function inspectSPX() {
  const url = 'https://egy.app.spx-learning-square.com/';
  console.log(`Inspecting ${url} ...`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Status code:', res?.status());
    console.log('Final URL:', page.url());
    console.log('Title:', await page.title());

    // Wait a couple seconds in case of SPA client routing
    await page.waitForTimeout(3000);
    console.log('Final URL after wait:', page.url());

    // Inspect inputs and buttons
    const inputs = await page.$$eval('input', (elements) =>
      elements.map((el) => ({
        type: el.type,
        name: el.name,
        id: el.id,
        placeholder: el.placeholder,
        className: el.className,
      }))
    );
    console.log('Discovered Inputs:', JSON.stringify(inputs, null, 2));

    const buttons = await page.$$eval('button, a[role="button"], input[type="submit"]', (elements) =>
      elements.map((el) => ({
        tagName: el.tagName,
        text: el.textContent?.trim(),
        type: el.getAttribute('type'),
        id: el.id,
        className: el.className,
      }))
    );
    console.log('Discovered Buttons:', JSON.stringify(buttons, null, 2));

    // Sample body text/structure
    const bodyText = await page.$eval('body', el => el.innerText.slice(0, 1000));
    console.log('Page excerpt:', bodyText);
  } catch (err: any) {
    console.error('Inspection failed:', err.message);
  } finally {
    await browser.close();
  }
}

inspectSPX();
