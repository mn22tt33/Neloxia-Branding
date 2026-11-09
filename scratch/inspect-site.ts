import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function inspect() {
  const browser = await chromium.launch({
    headless: false, // headed can help bypass simple cloudflare JS challenges easily
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();

  const networkLogs: any[] = [];
  page.on('request', req => {
    networkLogs.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      postData: req.postData()
    });
  });

  page.on('response', async res => {
    const url = res.url();
    if (url.includes('.js') || url.includes('/api/') || url.includes('json')) {
      try {
        const text = await res.text();
        const filename = path.basename(new URL(url).pathname) || 'res.txt';
        fs.writeFileSync(`temp_${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`, text);
      } catch (e) {}
    }
  });

  console.log('Navigating to qureosolver.xyz...');
  try {
    await page.goto('https://qureosolver.xyz/', { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    console.log('qureosolver.xyz load error or timeout, trying without networkidle...');
    try {
      await page.goto('https://qureosolver.xyz/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
    } catch (e2) {
      console.log('Failed:', e2);
    }
  }

  await page.waitForTimeout(6000);

  const title = await page.title();
  const url = page.url();
  console.log('Loaded URL:', url, 'Title:', title);

  const content = await page.content();
  fs.writeFileSync('qureo_page_dump.html', content);

  await page.screenshot({ path: 'qureo_site.png', fullPage: true });

  fs.writeFileSync('qureo_network.json', JSON.stringify(networkLogs, null, 2));

  console.log('Page saved. Now inspecting scripts and inputs...');

  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, button, select, form')).map(el => ({
      tag: el.tagName,
      id: el.id,
      name: (el as any).name,
      type: (el as any).type,
      placeholder: (el as any).placeholder,
      text: el.textContent?.trim()
    }));
  });

  console.log('Found elements:', JSON.stringify(inputs, null, 2));

  await browser.close();
}

inspect().catch(console.error);
