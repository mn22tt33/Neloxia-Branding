/**
 * QUERO / SPRIX Direct Terminal Solver (Backend CLI)
 * Run directly: node solve.js [studentId] [password]
 * Zero AI • 418 Verified Central Answers • Visible Browser Mode
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Color helpers for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

function log(level, message) {
  const time = new Date().toTimeString().split(' ')[0];
  let color = colors.cyan;
  let icon = 'ℹ';
  if (level === 'success') { color = colors.green; icon = '✓'; }
  if (level === 'warn') { color = colors.yellow; icon = '⚠'; }
  if (level === 'error') { color = colors.red; icon = '✗'; }
  if (level === 'title') { color = colors.magenta; icon = '🚀'; }
  console.log(`${color}[${time}] ${icon} ${message}${colors.reset}`);
}

// Load 418 Verified Questions
let knowledgeStore = [];
try {
  const storePath = path.join(__dirname, 'data', 'question_knowledge_store.json');
  if (fs.existsSync(storePath)) {
    knowledgeStore = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    log('success', `تم تحميل بنك الأسئلة المعتمد بنجاح (${knowledgeStore.length} سؤالاً نموذجياً موثقاً).`);
  }
} catch (e) {
  log('warn', `تعذر قراءة بنك الأسئلة: ${e.message}`);
}

function normalizeText(text) {
  if (!text) return '';
  return text
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/["'«»“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function findBestAnswer(options) {
  for (const opt of options) {
    const cleanOpt = normalizeText(opt);
    for (const record of knowledgeStore) {
      const cleanAns = normalizeText(record.verifiedAnswer || record.answer || '');
      if (cleanAns && (cleanOpt.includes(cleanAns) || cleanAns.includes(cleanOpt))) {
        return {
          matchedOption: opt,
          verifiedAnswer: record.verifiedAnswer,
          confidence: 1.0,
        };
      }
    }
  }
  return null;
}

async function promptCredentials() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  console.log('\n' + colors.bright + colors.magenta + '==================================================' + colors.reset);
  console.log(colors.bright + colors.cyan + '    QUERO / SPRIX DIRECT TERMINAL SOLVER (Zero AI)   ' + colors.reset);
  console.log(colors.bright + colors.magenta + '==================================================' + colors.reset + '\n');

  const studentId = await question(colors.bright + 'أدخل كود الطالب (Student ID): ' + colors.reset);
  const password = await question(colors.bright + 'أدخل كلمة المرور (Password): ' + colors.reset);
  rl.close();

  return { studentId: studentId.trim(), password: password.trim() };
}

async function startCliSolver() {
  let studentId = process.argv[2];
  let password = process.argv[3];

  if (!studentId || !password) {
    const creds = await promptCredentials();
    studentId = creds.studentId;
    password = creds.password;
  }

  if (!studentId || !password) {
    log('error', 'يرجى إدخال كود الطالب وكلمة المرور.');
    process.exit(1);
  }

  log('title', `بدء جلسة الحل المباشر للطالب: [${studentId}]...`);
  log('info', 'جاري إطلاق متصفح Chromium المرئي...');

  const browser = await chromium.launch({
    headless: false, // User can see the browser solving live!
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: null, // Full maximized window
    locale: 'ar-EG',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    // 1. LOGIN
    log('info', 'جاري الاتصال بصفحة الدخول: https://egy.app.spx-learning-square.com/login...');
    await page.goto('https://egy.app.spx-learning-square.com/login', { waitUntil: 'load', timeout: 30000 });
    
    // Wait for React hydration
    await page.waitForSelector('#login-id', { timeout: 20000 });
    log('info', 'تم تحميل نموذج الدخول. جاري كتابة كود الطالب وكلمة المرور...');

    await page.fill('#login-id', studentId);
    await page.waitForTimeout(300);
    await page.fill('#password', password);
    await page.waitForTimeout(500);

    const submitBtn = page.locator('button:has-text("Let\'s Go!"), button:has-text("يلا بينا!")').first();
    log('info', 'الضغط على زر الدخول (Let\'s Go!)...');
    await submitBtn.click();

    // 2. WAIT FOR REDIRECT
    await page.waitForURL((url) => !url.href.includes('/login'), { timeout: 20000 });
    log('success', 'تم تسجيل الدخول بنجاح!');

    await page.waitForTimeout(2000);

    // 3. DASHBOARD -> SUBJECTS
    if (page.url().includes('/dashboard')) {
      log('info', 'في لوحة التحكم. الضغط على زر "كمّل"...');
      const continueBtn = page.locator('button:has-text("كمّل"), div:has-text("كمّل")').last();
      await continueBtn.click();
      await page.waitForTimeout(2000);
    }

    // 4. SUBJECTS -> CURRICULUM
    if (page.url().includes('/subjects/') && !page.url().includes('/curriculum')) {
      log('info', 'في صفحة المقرر. الضغط على زر "كمّل التعلم"...');
      const resumeBtn = page.locator('button:has-text("كمّل التعلم"), a:has-text("كمّل التعلم")').first();
      await resumeBtn.click();
      await page.waitForTimeout(3000);
    }

    log('success', `تم الوصول لخريطة المنهج الدراسي: ${page.url()}`);
    await page.waitForTimeout(2000);

    // 5. SOLVER LOOP
    let solvedLessonsCount = 0;
    const maxLessonsToSolve = 25;

    while (solvedLessonsCount < maxLessonsToSolve) {
      log('info', 'جاري فحص وتوسيع وحدات وفصول المنهج...');
      
      // Expand unit: "أساسيات المال والتمويل" or first unit
      const unitHeader = page.locator('button:has-text("عنصر"), button:has-text("أساسيات المال والتمويل")').first();
      if (await unitHeader.isVisible()) {
        await unitHeader.click();
        await page.waitForTimeout(1000);
      }

      // Expand chapters in order
      const chapterNames = ['دور المال', 'دور التمويل في المجتمع', 'البنية الأساسية للاقتصاد', 'فهم الزكاة'];
      let targetLesson = null;

      for (const chName of chapterNames) {
        const chBtn = page.locator(`text="${chName}"`).first();
        if (await chBtn.isVisible()) {
          await chBtn.click();
          await page.waitForTimeout(800);

          // Find unlocked lesson that is NOT completed
          const candidateLessons = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('div.cursor-pointer'))
              .filter(el => {
                const text = el.innerText || '';
                const isCompleted = el.className.includes('#00bb88') || el.className.includes('bg-[#00bb88]') || el.querySelector('.lucide-check') !== null;
                const isLocked = el.className.includes('opacity-40') || el.className.includes('cursor-default') || el.getAttribute('title') === 'مقفول';
                const isChapterHeader = text.includes('دور') || text.includes('البنية') || text.includes('فهم') || text.includes('عنصر') || text.includes('رجوع');
                return !isCompleted && !isLocked && !isChapterHeader && text.length > 2 && text.length < 50;
              })
              .map(el => el.innerText.trim().split('\n')[0]);
          });

          if (candidateLessons.length > 0) {
            targetLesson = candidateLessons[0];
            log('success', `تم العثور على الدرس المفتوح المستهدف: "${targetLesson}" في فصل [${chName}]`);
            break;
          }
        }
      }

      if (!targetLesson) {
        log('warn', 'لم يتم العثور على دروس مفتوحة غير مكتملة في هذا الفصل. فحص زر "كمّل التعلم"...');
        break;
      }

      // Click the unlocked lesson
      log('info', `فتح الدرس: "${targetLesson}"...`);
      const lessonLocator = page.locator(`text="${targetLesson}"`).first();
      await lessonLocator.click();
      await page.waitForTimeout(3000);

      // Solve all questions inside this lesson
      log('info', 'جاري استخراج وحل الأسئلة التفاعلية...');
      let answeredCount = 0;

      for (let q = 1; q <= 15; q++) {
        // Scroll down
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(800);

        // Find active, enabled radio options
        const radioLocators = page.locator('div[role="radio"]:not([aria-disabled="true"]):not([aria-checked="true"]):not(.cursor-default)');
        const activeCount = await radioLocators.count();

        if (activeCount === 0) {
          log('info', 'تم حل جميع الأسئلة التفاعلية بنجاح!');
          break;
        }

        // Get option texts
        const optionTexts = [];
        for (let i = 0; i < activeCount; i++) {
          optionTexts.push(await radioLocators.nth(i).innerText());
        }

        // Match with 418 verified answers
        const bestMatch = findBestAnswer(optionTexts);
        if (bestMatch) {
          log('success', `[قاعدة المعرفة 0ms] سؤال #${q}: تم العثور على إجابة موثقة -> "${bestMatch.verifiedAnswer.substring(0, 45)}..."`);
          
          // Click the matching enabled option
          const targetOptLocator = page.locator('div[role="radio"]:not([aria-disabled="true"]):not(.cursor-default)').filter({ hasText: bestMatch.verifiedAnswer.substring(0, 15) }).first();
          if (await targetOptLocator.isVisible()) {
            await targetOptLocator.scrollIntoViewIfNeeded();
            await targetOptLocator.click();
            await page.waitForTimeout(600);

            // Click "راجع إجابتي"
            const reviewBtn = page.locator('button:has-text("راجع إجابتي"):not([disabled])').first();
            if (await reviewBtn.isVisible({ timeout: 2000 })) {
              await reviewBtn.click();
              log('success', `تم تسليم إجابة السؤال #${q} بنجاح!`);
              answeredCount++;
              await page.waitForTimeout(1500);
            }
          }
        } else {
          log('warn', `سؤال #${q}: لا توجد أسئلة جديدة قابلة للحل.`);
          break;
        }
      }

      // Check for Keyword Review Cards ("النقاط المهمة")
      const keywordCards = page.locator('button:has-text("النقاط المهمة")');
      const cardsCount = await keywordCards.count();
      if (cardsCount > 0) {
        log('info', `تم اكتشاف بطاقات النقاط المهمة (${cardsCount} بطاقة). جاري مراجعتها وتأكيدها...`);
        for (let i = 0; i < cardsCount; i++) {
          try {
            await keywordCards.nth(i).scrollIntoViewIfNeeded();
            await keywordCards.nth(i).click();
            await page.waitForTimeout(300);
          } catch (_) {}
        }
        await page.waitForTimeout(800);

        const finishReviewBtn = page.locator('button:has-text("راجعت كل حاجة"):not([disabled])').first();
        if (await finishReviewBtn.isVisible({ timeout: 3000 })) {
          await finishReviewBtn.scrollIntoViewIfNeeded();
          await finishReviewBtn.click();
          log('success', 'تم تأكيد مراجعة جميع بطاقات النقاط المهمة بنجاح!');
          await page.waitForTimeout(2000);
        }
      }

      // Click "التالي" to conclude lesson
      const nextBtn = page.locator('button:has-text("التالي"), button:has-text("إنهاء")').last();
      if (await nextBtn.isVisible({ timeout: 2500 })) {
        log('info', 'الضغط على زر "التالي" لإنهاء الدرس والعودة للقائمة...');
        await nextBtn.scrollIntoViewIfNeeded();
        await nextBtn.click();
        await page.waitForTimeout(3000);
      }

      solvedLessonsCount++;
      log('success', `🎉 تم إنجاز الدرس (${solvedLessonsCount}) بنجاح! جاري الانتقال للدرس التالي...`);

      // Return to curriculum view if needed
      if (!page.url().includes('/curriculum')) {
        const backBtn = page.locator('button:has-text("رجوع"), a:has-text("رجوع")').first();
        if (await backBtn.isVisible({ timeout: 2000 })) {
          await backBtn.click();
          await page.waitForTimeout(2000);
        }
      }
    }

    log('title', `🏆 تهانينا! تم إنجاز ${solvedLessonsCount} دروس بنجاح واكتمال الخطة.`);
    await page.waitForTimeout(5000);

  } catch (error) {
    log('error', `حدث خطأ أثناء التنفيذ: ${error.message}`);
    console.error(error);
  } finally {
    log('info', 'جاري إغلاق المتصفح...');
    await browser.close().catch(() => {});
    log('success', 'تم إنهاء الجلسة بنجاح.');
  }
}

startCliSolver().catch(console.error);
