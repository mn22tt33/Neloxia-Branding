import { chromium } from 'playwright';
import { GenericEducationalAdapter } from '../../src/browser/adapters';

describe('Playwright Headless, Isolation & Extraction Suite', () => {
  test('should launch Chromium in headless mode, isolate contexts, extract questions, and take screenshots', async () => {
    // 1. Launch Headless Browser
    const browser = await chromium.launch({ headless: true });
    expect(browser).toBeDefined();

    // 2. Isolated Context 1 (Student A)
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.setContent(`
      <html>
        <body>
          <div class="question-container">
            <h3 class="question-text">What is the capital of Spain?</h3>
            <label><input type="radio" name="q1" value="Madrid" /> Madrid</label>
            <label><input type="radio" name="q1" value="Barcelona" /> Barcelona</label>
            <label><input type="radio" name="q1" value="Seville" /> Seville</label>
          </div>
        </body>
      </html>
    `);

    // 3. Isolated Context 2 (Student B) - Different content
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.setContent(`
      <html>
        <body>
          <div class="quiz-question">
            <p class="prompt">True or False: The Atlantic Ocean is larger than the Pacific Ocean?</p>
            <label><input type="radio" name="q2" value="True" /> True</label>
            <label><input type="radio" name="q2" value="False" /> False</label>
          </div>
        </body>
      </html>
    `);

    // 4. Verify DOM question detection using Adapter
    const adapter = new GenericEducationalAdapter();

    const questionsA = await adapter.detectQuestions(pageA);
    expect(questionsA.length).toBeGreaterThan(0);
    expect(questionsA[0].text).toContain('capital of Spain');
    expect(questionsA[0].type).toBe('MULTIPLE_CHOICE');
    expect(questionsA[0].options).toContain('Madrid');

    const questionsB = await adapter.detectQuestions(pageB);
    expect(questionsB.length).toBeGreaterThan(0);
    expect(questionsB[0].text).toContain('Atlantic Ocean');
    expect(questionsB[0].type).toBe('TRUE_FALSE');
    expect(questionsB[0].options).toContain('True');

    // 5. Verify Screenshot Capture
    const screenshotBuffer = await pageA.screenshot({ fullPage: false });
    expect(screenshotBuffer).toBeInstanceOf(Buffer);
    expect(screenshotBuffer.length).toBeGreaterThan(100);

    // 6. Verify Context Isolation: cookies/storage do not leak
    await contextA.addCookies([{ name: 'student_token', value: 'token_A', domain: 'example.com', path: '/' }]);
    const cookiesA = await contextA.cookies('https://example.com');
    const cookiesB = await contextB.cookies('https://example.com');

    expect(cookiesA.some(c => c.value === 'token_A')).toBe(true);
    expect(cookiesB.some(c => c.value === 'token_A')).toBe(false);

    // 7. Cleanup & Resource Release
    await contextA.close();
    await contextB.close();
    await browser.close();
  }, 25000);
});
