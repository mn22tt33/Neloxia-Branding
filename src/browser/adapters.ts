import { Page, Locator } from 'playwright';
import { ExtractedQuestionData } from '../types';

export interface IPlatformAdapter {
  platformName: string;
  matchUrl(url: string): boolean;
  login(page: Page, credentials: { username: string; password?: string }): Promise<boolean>;
  detectQuestions(page: Page): Promise<ExtractedQuestionData[]>;
}

export abstract class BasePlatformAdapter implements IPlatformAdapter {
  abstract platformName: string;
  abstract matchUrl(url: string): boolean;

  async login(page: Page, credentials: { username: string; password?: string }): Promise<boolean> {
    try {
      const userField = page.locator(
        'input[type="text"], input[type="email"], input[name*="user"], input[name*="login"], input[id*="user"]'
      ).first();
      
      if (await userField.isVisible({ timeout: 5000 })) {
        await userField.fill(credentials.username);
      }

      if (credentials.password) {
        const passField = page.locator('input[type="password"]').first();
        if (await passField.isVisible({ timeout: 5000 })) {
          await passField.fill(credentials.password);
        }
      }

      const submitBtn = page.locator(
        'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In"), button:has-text("تسجيل الدخول")'
      ).first();

      if (await submitBtn.isVisible({ timeout: 3000 })) {
        await submitBtn.click();
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      }

      return true;
    } catch {
      return false;
    }
  }

  async detectQuestions(page: Page): Promise<ExtractedQuestionData[]> {
    const questions: ExtractedQuestionData[] = [];

    // Flexible container selectors used by major quiz & learning systems
    const containerSelectors = [
      '.question-container',
      '.quiz-question',
      '.question_holder',
      '.assessment-question',
      '[data-question-id]',
      '[role="group"]',
      '.form-group:has(input[type="radio"])',
      'fieldset:has(input[type="radio"])',
    ];

    for (const selector of containerSelectors) {
      const elements = page.locator(selector);
      const count = await elements.count();

      if (count > 0) {
        for (let i = 0; i < Math.min(count, 10); i++) {
          const item = elements.nth(i);
          const qData = await this.extractFromContainer(item, page);
          if (qData) {
            questions.push(qData);
          }
        }
        if (questions.length > 0) return questions;
      }
    }

    // Fallback: If no distinct question containers, check document headings/prompts
    const heading = await page.locator('h1, h2, h3, .prompt, .stem_text').first();
    if (await heading.isVisible({ timeout: 1000 }).catch(() => false)) {
      const text = (await heading.innerText()).trim();
      if (text.length > 5) {
        // Collect radio/checkbox options
        const optionLocators = page.locator('label, input[type="radio"] + span, .choice-label');
        const optCount = await optionLocators.count();
        const options: string[] = [];

        for (let j = 0; j < Math.min(optCount, 8); j++) {
          const optText = (await optionLocators.nth(j).innerText()).trim();
          if (optText && !options.includes(optText)) {
            options.push(optText);
          }
        }

        questions.push({
          text,
          type: options.length > 0 ? 'MULTIPLE_CHOICE' : 'SHORT_ANSWER',
          options: options.length > 0 ? options : undefined,
        });
      }
    }

    return questions;
  }

  protected async extractFromContainer(
    locator: Locator,
    page: Page
  ): Promise<ExtractedQuestionData | null> {
    try {
      // Find question text/title inside the container
      const promptLocators = locator.locator('.question-text, .prompt, .stem, h3, h4, p, legend, label').first();
      let text = '';
      if (await promptLocators.isVisible({ timeout: 1000 }).catch(() => false)) {
        text = (await promptLocators.innerText()).trim();
      } else {
        text = (await locator.innerText()).split('\n')[0].trim();
      }

      if (!text || text.length < 3) return null;

      // Extract options
      const optionElements = locator.locator('label, [role="radio"], .option, .choice');
      const optCount = await optionElements.count();
      const options: string[] = [];

      for (let i = 0; i < optCount; i++) {
        const optText = (await optionElements.nth(i).innerText()).trim();
        if (optText && optText !== text && !options.includes(optText)) {
          options.push(optText);
        }
      }

      // Check for image inside question container
      let image: string | undefined;
      const imgLocator = locator.locator('img').first();
      if (await imgLocator.isVisible({ timeout: 500 }).catch(() => false)) {
        image = (await imgLocator.getAttribute('src')) || undefined;
      }

      let type: ExtractedQuestionData['type'] = 'MULTIPLE_CHOICE';
      if (options.length === 2 && options.some(o => /true|صح/i.test(o)) && options.some(o => /false|خطأ/i.test(o))) {
        type = 'TRUE_FALSE';
      } else if (options.length === 0) {
        type = 'SHORT_ANSWER';
      }

      return {
        text,
        type,
        options: options.length > 0 ? options : undefined,
        image,
      };
    } catch {
      return null;
    }
  }
}

export class GenericEducationalAdapter extends BasePlatformAdapter {
  platformName = 'Generic Educational Platform';

  matchUrl(_url: string): boolean {
    return true; // Fallback for all supported platforms
  }
}

export class KhanAcademyAdapter extends BasePlatformAdapter {
  platformName = 'Khan Academy';

  matchUrl(url: string): boolean {
    return url.includes('khanacademy.org');
  }

  override async detectQuestions(page: Page): Promise<ExtractedQuestionData[]> {
    const questions: ExtractedQuestionData[] = [];
    const exerciseContainer = page.locator('[data-test-id="exercise-question-renderer"], .perseus-renderer');

    if (await exerciseContainer.isVisible({ timeout: 2000 }).catch(() => false)) {
      const qText = (await exerciseContainer.first().innerText()).trim();
      const options: string[] = [];
      const choiceLocators = page.locator('button[data-test-id*="choice"], .perseus-radio-option');
      const count = await choiceLocators.count();

      for (let i = 0; i < count; i++) {
        const opt = (await choiceLocators.nth(i).innerText()).trim();
        if (opt) options.push(opt);
      }

      questions.push({
        text: qText,
        type: options.length > 0 ? 'MULTIPLE_CHOICE' : 'SHORT_ANSWER',
        options: options.length > 0 ? options : undefined,
      });
      return questions;
    }

    return super.detectQuestions(page);
  }
}

export class SPXLearningSquareAdapter extends BasePlatformAdapter {
  platformName = 'SPX Learning Square';

  matchUrl(url: string): boolean {
    return url.includes('spx-learning-square.com');
  }

  override async login(
    page: Page,
    credentials: { username: string; password?: string }
  ): Promise<boolean> {
    try {
      // 1. Locate inputs based on actual inspected DOM ids
      const idInput = page.locator('#login-id, input[placeholder*="login ID" i], input[autocomplete="username"]').first();
      await idInput.waitFor({ state: 'visible', timeout: 10000 });
      await idInput.fill(credentials.username);

      if (credentials.password) {
        const passwordInput = page.locator('#password, input[placeholder*="password" i], input[type="password"]').first();
        await passwordInput.waitFor({ state: 'visible', timeout: 5000 });
        await passwordInput.fill(credentials.password);
      }

      // 2. Click "Let's Go!" submit button
      const submitBtn = page.locator('button[type="submit"]:has-text("Let\'s Go!"), button:has-text("Let\'s Go!"), button[type="submit"]').first();
      if (await submitBtn.isVisible({ timeout: 5000 })) {
        await submitBtn.click();
      }

      // 3. Wait for post-login navigation or error prompt
      await page.waitForTimeout(3000);

      // Check for login failure alert / toast
      const errorEl = page.locator('[role="alert"], .text-red-500, .error-message, .toast').first();
      if (await errorEl.isVisible({ timeout: 2000 }).catch(() => false)) {
        const errorText = await errorEl.innerText();
        throw new Error(`SPX Login Failed: ${errorText}`);
      }

      return true;
    } catch (err: any) {
      throw new Error(`SPX Platform Login Error: ${err.message}`);
    }
  }

  override async detectQuestions(page: Page): Promise<ExtractedQuestionData[]> {
    const questions: ExtractedQuestionData[] = [];

    // 1. Detect SPX Multiple-Choice options directly (A, B, C, D)
    const optionsTexts = await page.$$eval(
      'button, [role="radio"], [role="button"], label',
      els => els.map(e => e.textContent?.trim() || '').filter(t => /^[A-D](\s|[.:-]|\b)/.test(t) && !t.includes('العب'))
    ).catch(() => []);

    if (optionsTexts.length >= 2) {
      // Find question prompt text in content container
      const contentEl = page.locator('main').last();
      let promptText = '';
      if (await contentEl.isVisible({ timeout: 1000 }).catch(() => false)) {
        const fullText = await contentEl.innerText().catch(() => '');
        const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 5 && !l.includes('العب'));
        const candidates = lines.filter(l => l.includes('؟') || l.includes('اختر') || l.includes('أي مما يلي') || l.includes('صعوب'));
        promptText = candidates.length > 0 ? candidates[candidates.length - 1] : (lines[0] || 'سؤال متعدد الخيارات');
      }

      questions.push({
        text: promptText,
        type: 'MULTIPLE_CHOICE',
        options: optionsTexts,
      });
      return questions;
    }

    // Focus strictly on academic lessons, assessments, quizzes, and educational exercise blocks (no games)
    const spxSelectors = [
      '.exercise-item',
      '.quiz-container',
      '.question-card',
      '.problem-container',
      '[data-testid*="question"]',
      '.assessment-view',
      '.lesson-content',
      'main form',
    ];

    for (const selector of spxSelectors) {
      const elements = page.locator(selector);
      const count = await elements.count();
      if (count > 0) {
        for (let i = 0; i < Math.min(count, 5); i++) {
          const item = elements.nth(i);
          const q = await this.extractFromContainer(item, page);
          if (q) questions.push(q);
        }
        if (questions.length > 0) return questions;
      }
    }

    // SPX Academic question prompt detection
    const promptLocator = page.locator('main h1, main h2, main h3, .question-text, .text-xl, .text-2xl').first();
    if (await promptLocator.isVisible({ timeout: 1500 }).catch(() => false)) {
      const text = (await promptLocator.innerText()).trim();
      // Skip navigation headers or game labels
      if (text.length > 3 && !text.includes('العب') && !text.includes('لعبة')) {
        const options: string[] = [];
        // Strictly target academic options (choices, radios, labels), excluding game buttons
        const optButtons = page.locator('main button:not([type="submit"]):not(:has-text("English")):not(:has-text("العب")), [role="radio"], .choice-item, label');
        const btnCount = await optButtons.count();

        for (let j = 0; j < Math.min(btnCount, 8); j++) {
          const optText = (await optButtons.nth(j).innerText()).trim();
          if (optText && optText !== text && !options.includes(optText) && optText !== 'العب') {
            options.push(optText);
          }
        }

        // Image in activity/question
        let imgUrl: string | undefined;
        const imgLocator = page.locator('main img:not([src*="logo"]):not([src*="game"])').first();
        if (await imgLocator.isVisible({ timeout: 500 }).catch(() => false)) {
          imgUrl = (await imgLocator.getAttribute('src')) || undefined;
        }

        questions.push({
          text,
          type: options.length > 0 ? 'MULTIPLE_CHOICE' : 'SHORT_ANSWER',
          options: options.length > 0 ? options : undefined,
          image: imgUrl,
        });
        return questions;
      }
    }

    // Fallback to base platform detection
    return super.detectQuestions(page);
  }
}

export class PlatformAdapterRegistry {
  private adapters: IPlatformAdapter[] = [
    new SPXLearningSquareAdapter(),
    new KhanAcademyAdapter(),
    new GenericEducationalAdapter(),
  ];

  public getAdapterForUrl(url: string): IPlatformAdapter {
    const found = this.adapters.find((a) => a.matchUrl(url));
    return found || this.adapters[this.adapters.length - 1];
  }

  public registerAdapter(adapter: IPlatformAdapter) {
    this.adapters.unshift(adapter);
  }
}

export const platformAdapterRegistry = new PlatformAdapterRegistry();
