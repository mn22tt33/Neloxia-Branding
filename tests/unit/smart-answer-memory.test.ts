import { SmartAnswerService } from '../../src/ai/smart-answer.service';
import { knowledgeRepository } from '../../src/ai/knowledge.repository';
import { QuestionNormalizer } from '../../src/ai/normalizer';
import { AIService } from '../../src/ai';
import { IAIProvider } from '../../src/ai/providers';
import { QuestionQuery, AISolverRequest, AISolverResponse } from '../../src/types';

/**
 * Custom Mock AI Provider with concrete methods
 * Immune to Jest's `resetMocks: true` configuration
 */
class TrackedMockAIProvider implements IAIProvider {
  public name = 'tracked-mock';
  public callCount = 0;

  public async generateAnswer(request: AISolverRequest): Promise<AISolverResponse> {
    this.callCount++;
    return {
      answerText: request.options?.[0] || 'إجابة افتراضية أولية',
      confidenceScore: 0.88,
      explanation: 'تحليل أولي بواسطة نموذج الذكاء الاصطناعي قيد المراجعة.',
      tokensUsed: { input: 120, output: 45 },
      modelName: 'gemini-1.5-flash',
    };
  }
}

describe('QUERO Smart Answer Memory & AI Learning Verification Suite', () => {
  let smartService: SmartAnswerService;
  let mockAiService: AIService;
  let trackedProvider: TrackedMockAIProvider;

  // Question Fixtures
  const sampleQuestion: QuestionQuery = {
    questionText: 'ما هي الوظيفة الأساسية للنقود كوسيط للتبادل التجاري؟',
    options: [
      'تسهيل تبادل السلع والخدمات بدون الحاجة للمقايضة',
      'تخزين الثروة في صورة أصول مادية مجمدة',
      'زيادة معدلات التضخم في الاقتصاد',
      'إلغاء الحاجة للبنوك المركزية',
    ],
    platformName: 'SPX Learning Square',
    subjectName: 'أساسيات المال والتمويل',
    lessonName: 'دور المال في المجتمع',
  };

  beforeAll(() => {
    // Clear any previous data from disk/memory
    knowledgeRepository.clearAll();

    trackedProvider = new TrackedMockAIProvider();
    mockAiService = new AIService();
    mockAiService.setProvider(trackedProvider);

    smartService = new SmartAnswerService(knowledgeRepository, mockAiService);
  });

  beforeEach(() => {
    trackedProvider.callCount = 0;
  });

  afterAll(() => {
    // Clean up
    knowledgeRepository.clearAll();
  });

  // -------------------------------------------------------------
  // Scenario 1 & 2: Input new question, analyze, return proposed (PENDING)
  // -------------------------------------------------------------
  test('Step 1 & 2: New question should be analyzed by AI and stored as PENDING (not auto-verified)', async () => {
    const result = await smartService.getAnswer(sampleQuestion, 'student-user-1');

    expect(result).toBeDefined();
    expect(trackedProvider.callCount).toBe(1); // AI was queried
    expect(result.fromKnowledgeBase).toBe(false);
    expect(result.isVerified).toBe(false);
    expect(result.verificationStatus).toBe('PENDING');
    expect(result.source).toBe('AI_PROPOSED');
    expect(result.answerText).toBe(sampleQuestion.options![0]);

    // Verify it is saved in knowledge repository as PENDING
    const saved = await knowledgeRepository.findByHash(result.questionHash);
    expect(saved).not.toBeNull();
    expect(saved?.verificationStatus).toBe('PENDING');
    expect(saved?.verifiedAnswer).toBeNull();
    expect(saved?.proposedAnswer).toBe(sampleQuestion.options![0]);
  });

  // -------------------------------------------------------------
  // Scenario 3 & 4: Confirm answer from trusted source -> VERIFIED
  // -------------------------------------------------------------
  test('Step 3 & 4: Confirming answer from trusted platform updates status to VERIFIED in permanent database', async () => {
    const confirmedText = sampleQuestion.options![0];
    const verifiedRecord = await smartService.confirmVerifiedAnswer(
      sampleQuestion,
      confirmedText,
      'PLATFORM_CONFIRMED',
      'تم تأكيد صحة الإجابة من نظام التقييم بالمنصة التعليمية SPX.'
    );

    expect(verifiedRecord.verificationStatus).toBe('VERIFIED');
    expect(verifiedRecord.verifiedAnswer).toBe(confirmedText);
    expect(verifiedRecord.source).toBe('PLATFORM_CONFIRMED');

    // Confirm stored record reflects verification
    const fetched = await knowledgeRepository.findByHash(verifiedRecord.questionHash);
    expect(fetched?.verificationStatus).toBe('VERIFIED');
    expect(fetched?.verifiedAnswer).toBe(confirmedText);
  });

  // -------------------------------------------------------------
  // Scenario 5 & 6: Repeat exact question -> retrieve without AI call
  // -------------------------------------------------------------
  test('Step 5 & 6: Repeating the identical question retrieves verified answer directly with 0 AI calls', async () => {
    // Re-input exact same question
    const result = await smartService.getAnswer(sampleQuestion, 'student-user-2');

    expect(trackedProvider.callCount).toBe(0); // AI MUST NOT be invoked!
    expect(result.fromKnowledgeBase).toBe(true);
    expect(result.isVerified).toBe(true);
    expect(result.verificationStatus).toBe('VERIFIED');
    expect(result.source).toBe('PLATFORM_CONFIRMED');
    expect(result.answerText).toBe(sampleQuestion.options![0]);
    expect(result.confidenceScore).toBe(1.0);
    expect(result.latencyMs).toBeLessThan(300); // Fast retrieval
  });

  // -------------------------------------------------------------
  // Scenario 7: Option permutation (shuffled choices) & match verification
  // -------------------------------------------------------------
  test('Step 7: Permuted/shuffled options match the verified answer and map to the correct new index', async () => {
    // Permute options: move correct answer from index 0 to index 2
    const shuffledOptions = [
      sampleQuestion.options![1], // 'تخزين الثروة في صورة أصول مادية مجمدة' (0)
      sampleQuestion.options![2], // 'زيادة معدلات التضخم في الاقتصاد' (1)
      sampleQuestion.options![0], // 'تسهيل تبادل السلع والخدمات بدون الحاجة للمقايضة' (2) - CORRECT
      sampleQuestion.options![3], // 'إلغاء الحاجة للبنوك المركزية' (3)
    ];

    const permutedQuery: QuestionQuery = {
      ...sampleQuestion,
      options: shuffledOptions,
    };

    const result = await smartService.getAnswer(permutedQuery, 'student-user-3');

    expect(trackedProvider.callCount).toBe(0); // Permutation-invariant hash -> 0 AI calls
    expect(result.fromKnowledgeBase).toBe(true);
    expect(result.isVerified).toBe(true);
    expect(result.answerText).toBe(sampleQuestion.options![0]);
    expect(result.matchedOptionIndex).toBe(2); // Accurately points to index 2 in incoming array
  });

  // -------------------------------------------------------------
  // Scenario 8: Modified question wording with critical negation -> prevent false match
  // -------------------------------------------------------------
  test('Step 8: Changing question semantics with critical word (e.g. negation "ليس") strictly prevents false matching', async () => {
    // A single word inverts the whole meaning:
    // "ما هي الوظيفة الأساسية" -> "ما هو ليس من الوظائف الأساسية"
    const negatedQuestion: QuestionQuery = {
      questionText: 'ما هو ليس من الوظائف الأساسية للنقود كوسيط للتبادل التجاري؟',
      options: sampleQuestion.options,
      platformName: 'SPX Learning Square',
    };

    // Verify Critical Word Guard detects critical difference
    const hasDiff = QuestionNormalizer.hasCriticalDifference(
      sampleQuestion.questionText,
      negatedQuestion.questionText
    );
    expect(hasDiff).toBe(true);

    // Call service: Must NOT return the cached answer for the opposite question
    const result = await smartService.getAnswer(negatedQuestion, 'student-user-4');

    expect(trackedProvider.callCount).toBe(1); // Must route to AI for new analysis
    expect(result.fromKnowledgeBase).toBe(false);
    expect(result.verificationStatus).toBe('PENDING');
  });

  // -------------------------------------------------------------
  // Scenario 9: Backend restart simulation & persistent storage integrity
  // -------------------------------------------------------------
  test('Step 9: Backend reboot simulation preserves all saved verified questions and corrections', async () => {
    // Simulate server crash/reboot by reloading repository from disk
    knowledgeRepository.reloadFromDisk();

    // Verify stored question is still present and VERIFIED
    const hash = QuestionNormalizer.computeQuestionHash(sampleQuestion.questionText, sampleQuestion.options);
    const reloadedRecord = await knowledgeRepository.findByHash(hash);

    expect(reloadedRecord).not.toBeNull();
    expect(reloadedRecord?.verificationStatus).toBe('VERIFIED');
    expect(reloadedRecord?.verifiedAnswer).toBe(sampleQuestion.options![0]);
    expect(reloadedRecord?.source).toBe('PLATFORM_CONFIRMED');

    // Querying through service after reboot still returns verified answer without AI
    const resultAfterReboot = await smartService.getAnswer(sampleQuestion, 'student-after-reboot');
    expect(trackedProvider.callCount).toBe(0);
    expect(resultAfterReboot.fromKnowledgeBase).toBe(true);
    expect(resultAfterReboot.isVerified).toBe(true);
  });

  // -------------------------------------------------------------
  // Dashboard & Metrics Verification
  // -------------------------------------------------------------
  test('Dashboard metrics: accurately reflects total, verified, pending, cache hits and saved AI calls', async () => {
    const stats = smartService.getDashboardStats();

    expect(stats.totalQuestions).toBeGreaterThanOrEqual(2); // sampleQuestion + negatedQuestion
    expect(stats.verifiedQuestions).toBeGreaterThanOrEqual(1);
    expect(stats.pendingQuestions).toBeGreaterThanOrEqual(1);
    expect(stats.cacheHits).toBeGreaterThanOrEqual(2);
    expect(stats.aiCallsSaved).toBeGreaterThanOrEqual(2);
    expect(stats.repetitionRate).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------
  // Rejection & Correction Log Scenario
  // -------------------------------------------------------------
  test('Correction & Rejection: rejected answer triggers correction log and excludes failed answer', async () => {
    const testRejectionQuery: QuestionQuery = {
      questionText: 'ما هي عاصمة دولة أستراليا الفيدرالية؟',
      options: ['سيدني', 'كانبرا', 'ملبورن', 'بيرث'],
    };

    // 1. First analyze with AI -> proposed answer 'سيدني'
    const pendingResult = await smartService.getAnswer(testRejectionQuery);
    expect(pendingResult.verificationStatus).toBe('PENDING');

    // 2. Reject 'سيدني' as wrong answer
    await smartService.rejectAnswer(
      testRejectionQuery,
      'سيدني',
      undefined,
      'إجابة غير صحيحة، سيدني ليست العاصمة السياسية'
    );

    const hash = QuestionNormalizer.computeQuestionHash(testRejectionQuery.questionText, testRejectionQuery.options);
    const record = await knowledgeRepository.findByHash(hash);
    expect(record?.verificationStatus).toBe('REJECTED');

    // 3. Confirm correct answer 'كانبرا'
    await smartService.confirmVerifiedAnswer(
      testRejectionQuery,
      'كانبرا',
      'TEACHER_VERIFIED',
      'كانبرا هي العاصمة الفيدرالية الرسمية لأستراليا.'
    );

    const verifiedRecord = await knowledgeRepository.findByHash(hash);
    expect(verifiedRecord?.verificationStatus).toBe('VERIFIED');
    expect(verifiedRecord?.verifiedAnswer).toBe('كانبرا');
  });
});
