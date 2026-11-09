import { chromium } from 'playwright';

async function listCurriculum() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  const page = await context.newPage();

  try {
    await page.goto('https://egy.app.spx-learning-square.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#login-id').fill(process.env.SPX_STUDENT_ID || '');
    await page.locator('#password').fill(process.env.SPX_STUDENT_PASSWORD || '');
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.locator('button:has-text("كمّل التعلم"), button:has-text("ابدأ")').first().click();
    await page.waitForTimeout(3000);

    // Expand unit 01
    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await unitBtn.click();
      await page.waitForTimeout(2000);
    }

    // List all topics/lessons in the sidebar
    const items = await page.$$eval('button, a', els =>
      els.filter(e => (e as HTMLElement).offsetParent !== null).map(e => e.textContent?.trim() || '').filter(t => t.length > 2 && !t.includes(process.env.SPX_STUDENT_ID || ''))
    );

    console.log('[+] Visible curriculum items in SPX:');
    items.forEach((item, idx) => console.log(`   [${idx + 1}] ${item}`));

    await page.screenshot({ path: 'tests/curriculum_tree.png' });
    console.log('[+] Screenshot saved to tests/curriculum_tree.png');

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

listCurriculum();
