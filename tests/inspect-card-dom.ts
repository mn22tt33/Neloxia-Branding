import { chromium } from 'playwright';

async function inspectCardDOM() {
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
    await page.goto('https://egy.app.spx-learning-square.com/subjects/7/curriculum', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) await unitBtn.click();
    await page.waitForTimeout(1500);

    const lesson1Btn = page.locator('button:has-text("دور المال")').first();
    if (await lesson1Btn.isVisible({ timeout: 4000 }).catch(() => false)) await lesson1Btn.click();
    await page.waitForTimeout(1500);

    const allQuizCandidates = page.locator('text="كيف نشأ المال"');
    await allQuizCandidates.last().click();
    await page.waitForTimeout(4000);

    // Inspect the first card HTML and children
    const firstCardHTML = await page.evaluate(() => {
      const btn = document.querySelector('button.relative');
      return {
        outerHTML: btn?.outerHTML?.substring(0, 500),
        innerHTML: btn?.innerHTML?.substring(0, 500),
      };
    });

    console.log('[+] First Card Outer:', firstCardHTML.outerHTML);
    console.log('[+] First Card Inner:', firstCardHTML.innerHTML);

    // Try clicking using Playwright's actual mouse click on the first button
    const firstCard = page.locator('button.relative').first();
    console.log('[+] Clicking first card with Playwright click()...');
    await firstCard.click();
    await page.waitForTimeout(1500);

    // Check if progress changed from 0/6
    const progressText = await page.evaluate(() => {
      return document.querySelector('main')?.innerText.match(/\d\/6/)?.[0] || 'not found';
    });
    console.log('[+] Progress after Playwright click:', progressText);

    await page.screenshot({ path: 'tests/card_clicked_test.png' });
    console.log('[+] Saved tests/card_clicked_test.png');

    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

inspectCardDOM();
