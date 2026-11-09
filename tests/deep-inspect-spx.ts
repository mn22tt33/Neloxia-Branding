import { chromium } from 'playwright';

async function inspectSPXElements() {
  const url = 'https://egy.app.spx-learning-square.com/';
  console.log(`Deep Inspecting: ${url}`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('Final URL after networkidle:', page.url());
    console.log('Title:', await page.title());

    // Inspect inputs
    const inputs = await page.$$eval('input', (els) =>
      els.map((el) => ({
        type: el.type,
        name: el.name,
        id: el.id,
        placeholder: el.placeholder,
        className: el.className,
        outerHTML: el.outerHTML,
      }))
    );
    console.log('Discovered Inputs:', JSON.stringify(inputs, null, 2));

    // Inspect buttons
    const buttons = await page.$$eval('button, a, input[type="submit"], [role="button"]', (els) =>
      els.map((el) => ({
        tag: el.tagName,
        text: el.textContent?.trim(),
        href: el.getAttribute('href'),
        type: el.getAttribute('type'),
        id: el.id,
        className: el.className,
      })).filter(b => b.text || b.id || b.href)
    );
    console.log('Discovered Action Elements:', JSON.stringify(buttons.slice(0, 20), null, 2));

    // Take a screenshot of the login screen
    const scr = await page.screenshot({ fullPage: false });
    console.log('Screenshot length:', scr.length);

    // Text dump
    console.log('Page text:');
    console.log(await page.locator('body').innerText());
  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
}

inspectSPXElements();
