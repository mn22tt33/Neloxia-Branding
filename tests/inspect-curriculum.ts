import { chromium } from 'playwright';

async function inspectCurriculum() {
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
    await page.locator('#login-id').fill('470777476');
    await page.locator('#password').fill('cR_fR_2C');
    await page.locator('button[type="submit"]:has-text("Let\'s Go!")').click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Go directly to curriculum page
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Expand unit 01
    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await unitBtn.click();
      await page.waitForTimeout(1500);
    }

    // Expand "دور المال"
    const lesson1Btn = page.locator('button:has-text("دور المال")').first();
    if (await lesson1Btn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await lesson1Btn.click();
      await page.waitForTimeout(1500);
    }

    // Extract all topics under "دور المال" and check their icons / status
    const topics = await page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('button, div[role="button"], a'));
      return allButtons.map(b => ({
        text: b.textContent?.trim() || '',
        className: b.className,
        visible: (b as HTMLElement).offsetParent !== null
      })).filter(b => b.visible && b.text.length > 2 && !b.text.includes('470777476'));
    });

    console.log('[+] Visible elements in curriculum:');
    topics.forEach((t, i) => console.log(`   [${i + 1}] "${t.text}"`));

    await page.screenshot({ path: 'tests/curriculum_expanded.png' });
    console.log('[+] Saved tests/curriculum_expanded.png');

    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

inspectCurriculum();
