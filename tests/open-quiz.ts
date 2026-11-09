import { chromium } from 'playwright';

async function openQuizItem() {
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

    // The second item has text "كيف نشأ المال" (the quiz with clipboard icon)
    // Find all elements with text "كيف نشأ المال"
    const items = page.locator('button:has-text("كيف نشأ المال"), div:has-text("كيف نشأ المال"), a:has-text("كيف نشأ المال")');
    const count = await items.count();
    console.log(`[+] Found ${count} items with text "كيف نشأ المال"`);

    // Click the second one!
    // In our sidebar, the second one is the quiz!
    const allQuizCandidates = page.locator('text="كيف نشأ المال"');
    const c2 = await allQuizCandidates.count();
    console.log(`[+] Total text candidates: ${c2}`);
    
    // Click the last one which is the quiz
    await allQuizCandidates.last().click();
    await page.waitForTimeout(5000);

    console.log('[+] Current URL:', page.url());
    await page.screenshot({ path: 'tests/quiz_opened.png' });
    console.log('[+] Saved tests/quiz_opened.png');

    // Inspect content of this quiz
    const quizContent = await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      return {
        text: main.innerText.substring(0, 1000),
        radioCount: document.querySelectorAll('[role="radio"], input[type="radio"]').length,
        buttonCount: document.querySelectorAll('button').length,
        buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim() || '')
      };
    });

    console.log('[+] Quiz Content Details:');
    console.log(JSON.stringify(quizContent, null, 2));

    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

openQuizItem();
