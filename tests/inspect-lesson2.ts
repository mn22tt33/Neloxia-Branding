import { chromium } from 'playwright';

async function inspectLesson2() {
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

    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) await unitBtn.click();
    await page.waitForTimeout(1500);

    const lesson1Btn = page.locator('button:has-text("دور المال")').first();
    if (await lesson1Btn.isVisible({ timeout: 4000 }).catch(() => false)) await lesson1Btn.click();
    await page.waitForTimeout(1500);

    // Click "الوظائف الثلاث للمال"
    const lesson2 = page.locator('text="الوظائف الثلاث للمال"').first();
    await lesson2.click();
    await page.waitForTimeout(5000);

    // Scroll innerMain down to question
    await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (inner) inner.scrollTop = inner.scrollHeight;
    });
    await page.waitForTimeout(2000);

    // Extract question data
    const qData = await page.evaluate(() => {
      const mains = document.querySelectorAll('main');
      const inner = mains[mains.length - 1];
      if (!inner) return null;

      const radios = Array.from(inner.querySelectorAll('[role="radio"]'));
      return {
        radioCount: radios.length,
        radios: radios.map(r => r.textContent?.trim() || ''),
        text: inner.innerText.substring(inner.innerText.length - 1000)
      };
    });

    console.log('[+] Lesson 2 First Question:', JSON.stringify(qData, null, 2));

    await page.screenshot({ path: 'tests/lesson2_first_question.png' });
    console.log('[+] Saved tests/lesson2_first_question.png');

    await page.waitForTimeout(10000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

inspectLesson2();
