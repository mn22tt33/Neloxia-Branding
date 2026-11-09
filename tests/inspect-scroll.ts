import { chromium } from 'playwright';

async function inspectAndScroll() {
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
    await page.locator('button:has-text("ابدأ")').first().click();
    await page.waitForTimeout(2000);

    await page.locator('button:has-text("ابدأ التعلم")').first().click();
    await page.waitForTimeout(3000);

    const unitBtn = page.locator('button:has-text("أساسيات المال والتمويل")').first();
    if (await unitBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await unitBtn.click();
      await page.waitForTimeout(2000);
    }

    await page.locator('button:has-text("دور المال")').first().click();
    await page.waitForTimeout(2000);

    await page.locator('text="كيف نشأ المال"').first().click();
    await page.waitForTimeout(5000);

    // Find all scrollable elements
    const scrollables = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const found: any[] = [];
      for (const el of all) {
        if (el.scrollHeight > el.clientHeight + 50) {
          found.push({
            tag: el.tagName,
            id: el.id,
            className: el.className,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            scrollTop: el.scrollTop
          });
        }
      }
      return found;
    });

    console.log('[+] Scrollable elements:');
    console.log(JSON.stringify(scrollables, null, 2));

    // Scroll every scrollable element to the bottom!
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      for (const el of all) {
        if (el.scrollHeight > el.clientHeight + 50) {
          el.scrollTop = el.scrollHeight;
        }
      }
      window.scrollTo(0, document.body.scrollHeight);
    });

    await page.waitForTimeout(2000);

    // Also send PageDown key several times in the center of the screen
    await page.mouse.move(640, 500);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 800);
      await page.keyboard.press('PageDown');
      await page.waitForTimeout(200);
    }

    await page.waitForTimeout(2000);

    // Now find elements containing "C" or "يملك ما تريده"
    const matchingElements = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const targets = all.filter(el => {
        const text = el.textContent?.trim() || '';
        return text.includes('يملك ما تريده') && el.children.length <= 2;
      });
      return targets.map(t => ({
        tag: t.tagName,
        className: t.className,
        text: t.textContent?.trim().substring(0, 80),
        role: t.getAttribute('role'),
        type: (t as any).type,
        rect: t.getBoundingClientRect()
      }));
    });

    console.log('[+] Matching elements for Option C:');
    console.log(JSON.stringify(matchingElements, null, 2));

    await page.screenshot({ path: 'tests/bottom_scrolled.png' });
    console.log('[+] Saved tests/bottom_scrolled.png');

    // If an element was found, click it!
    if (matchingElements.length > 0) {
      const best = matchingElements[0];
      console.log(`[+] Clicking at coordinates x: ${best.rect.x + 20}, y: ${best.rect.y + 20}`);
      await page.mouse.click(best.rect.x + 20, best.rect.y + 20);
      await page.waitForTimeout(1000);

      await page.screenshot({ path: 'tests/clicked_c.png' });
      console.log('[+] Saved tests/clicked_c.png');

      // Now click "راجع إجابتي"
      const submitBtn = page.locator('button:has-text("راجع إجابتي")').first();
      if (await submitBtn.isVisible().catch(() => false)) {
        console.log('[+] Clicking "راجع إجابتي"!');
        await submitBtn.click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'tests/after_submit_real.png' });
        console.log('[+] Saved tests/after_submit_real.png');
      }
    }

    await page.waitForTimeout(5000);

  } catch (err: any) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

inspectAndScroll();
