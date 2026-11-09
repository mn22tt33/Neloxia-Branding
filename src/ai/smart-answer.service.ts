import crypto from 'crypto';
import { QuestionNormalizer } from './normalizer';
import { knowledgeRepository, KnowledgeRepository } from './knowledge.repository';
import { missingQuestionService } from './missing-question.service';
import { logger } from '../utils/logger';
import { 
  QuestionQuery, 
  SmartAnswerResult, 
  QuestionKnowledgeRecord, 
  AnswerSource, 
  VerificationStatus,
  LearningDashboardStats
} from '../types';

export class SmartAnswerService {
  private repository: KnowledgeRepository;

  constructor(repository?: KnowledgeRepository) {
    this.repository = repository || knowledgeRepository;
  }

  /**
   * Main entrypoint: Retrieves answer strictly from verified knowledge base.
   * ABSOLUTE ZERO-AI POLICY:
   * 1. Searches knowledge base (exact hash or permutation-safe match).
   * 2. If verified answer found -> returns immediately (0 AI calls, 0ms latency).
   * 3. If NOT found -> NEVER guesses or uses AI. Logs to MissingQuestions store and returns NOT_FOUND.
   */
  public async getAnswer(query: QuestionQuery, userId: string = 'system-user', orderId?: string): Promise<SmartAnswerResult> {
    const startTime = Date.now();
    const hash = QuestionNormalizer.computeQuestionHash(query.questionText, query.options);

    // 1. Exact Hash Lookup in Persistent Knowledge Base
    const exactRecord = await this.repository.findByHash(hash);
    if (exactRecord) {
      exactRecord.occurrenceCount++;
      exactRecord.lastSeenAt = new Date();

      if (exactRecord.verificationStatus === 'VERIFIED' && exactRecord.verifiedAnswer) {
        exactRecord.retrievalCount++;
        await this.repository.upsertRecord(exactRecord);

        const latency = Date.now() - startTime;
        this.repository.recordQueryMetrics(true, latency);

        // Map answer to incoming option ordering
        const mappedAnswer = this.mapAnswerToIncomingOptions(
          exactRecord.verifiedAnswer,
          exactRecord.options,
          query.options || []
        );

        logger.info(`[SmartAnswerService] Instant verified knowledge hit for hash ${hash.substring(0, 8)} in ${latency}ms`);
        return {
          answerText: mappedAnswer.answerText,
          matchedOptionIndex: mappedAnswer.matchedOptionIndex,
          confidenceScore: 1.0,
          explanation: exactRecord.explanation || 'تم استرجاع الإجابة الموثقة مباشرة من قاعدة المعرفة المركزية.',
          isVerified: true,
          source: exactRecord.source,
          fromKnowledgeBase: true,
          questionHash: hash,
          verificationStatus: 'VERIFIED',
          latencyMs: latency,
        };
      }
    }

    // 2. Smart Fuzzy / Permutation Matching with Critical Word Guard
    const fuzzyMatch = await this.findSmartFuzzyMatch(query);
    if (fuzzyMatch) {
      const record = fuzzyMatch.record;
      record.occurrenceCount++;
      record.retrievalCount++;
      record.lastSeenAt = new Date();
      await this.repository.upsertRecord(record);

      const latency = Date.now() - startTime;
      this.repository.recordQueryMetrics(true, latency);

      logger.info(`[SmartAnswerService] Smart fuzzy verified match found (sim: ${fuzzyMatch.similarity.toFixed(2)}) in ${latency}ms`);
      return {
        answerText: fuzzyMatch.mappedAnswer.answerText,
        matchedOptionIndex: fuzzyMatch.mappedAnswer.matchedOptionIndex,
        confidenceScore: 1.0,
        explanation: record.explanation || 'تمت المطابقة واسترجاع الإجابة الموثقة مع ضبط ترتيب الاختيارات.',
        isVerified: true,
        source: record.source,
        fromKnowledgeBase: true,
        questionHash: record.questionHash,
        verificationStatus: 'VERIFIED',
        latencyMs: latency,
      };
    }

    // 3. ZERO-AI FALLBACK: Do NOT guess, do NOT use AI. Record as missing question for admin review.
    const latency = Date.now() - startTime;
    logger.warn(`[SmartAnswerService] Zero-AI Guard: Question not found in verified database. Capturing for admin review...`);

    await missingQuestionService.recordMissingQuestion({
      questionText: query.questionText,
      options: query.options || [],
      platformName: query.platformName,
      subjectName: query.subjectName,
      lessonName: query.lessonName,
      orderId,
    });

    return {
      answerText: 'NOT_FOUND',
      confidenceScore: 0.0,
      explanation: 'السؤال غير مسجل في قاعدة الأسئلة الموثقة. تم حفظ السؤال في قائمة المراجعة للإدارة.',
      isVerified: false,
      source: 'NOT_FOUND' as any,
      fromKnowledgeBase: false,
      questionHash: hash,
      verificationStatus: 'PENDING',
      latencyMs: latency,
    };
  }

  /**
   * Confirms and marks an answer as VERIFIED from a trusted source
   * (e.g. Platform success feedback 'إجابة صحيحة', or teacher review)
   */
  public async confirmVerifiedAnswer(
    query: QuestionQuery,
    verifiedAnswerText: string,
    source: AnswerSource = 'PLATFORM_CONFIRMED',
    explanation?: string,
    reason?: string
  ): Promise<QuestionKnowledgeRecord> {
    const hash = QuestionNormalizer.computeQuestionHash(query.questionText, query.options);
    let record = await this.repository.findByHash(hash);

    const oldAnswer = record?.verifiedAnswer || record?.proposedAnswer;
    const oldStatus = record?.verificationStatus || 'PENDING';

    if (!record) {
      record = {
        id: crypto.randomUUID(),
        questionHash: hash,
        normalizedText: QuestionNormalizer.normalizeArabicText(query.questionText),
        rawQuestionText: query.questionText,
        questionType: query.questionType || 'MULTIPLE_CHOICE',
        options: query.options || [],
        normalizedOptions: QuestionNormalizer.normalizeOptions(query.options || []),
        proposedAnswer: verifiedAnswerText,
        verifiedAnswer: verifiedAnswerText,
        explanation: explanation || 'تم التحقق من صحة الإجابة وتوثيقها بنجاح.',
        platformName: query.platformName,
        subjectName: query.subjectName,
        lessonName: query.lessonName,
        source,
        confidenceScore: 1.0,
        verificationStatus: 'VERIFIED',
        occurrenceCount: 1,
        retrievalCount: 0,
        lastSeenAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } else {
      record.verifiedAnswer = verifiedAnswerText;
      record.verificationStatus = 'VERIFIED';
      record.source = source;
      record.confidenceScore = 1.0;
      if (explanation) record.explanation = explanation;
      record.updatedAt = new Date();
    }

    await this.repository.upsertRecord(record);

    // Record change log
    await this.repository.logCorrection({
      id: crypto.randomUUID(),
      questionKnowledgeId: record.id,
      oldAnswer,
      newAnswer: verifiedAnswerText,
      oldStatus,
      newStatus: 'VERIFIED',
      source,
      reason: reason || 'تأكيد صحة الإجابة من المنصة التعليمية مباشرة',
      createdAt: new Date(),
    });

    logger.info(`[SmartAnswerService] Question marked as VERIFIED: "${verifiedAnswerText.substring(0, 40)}" (Hash: ${hash.substring(0, 8)})`);
    return record;
  }

  /**
   * Rejects an answer when proven wrong (e.g., 'مش مظبوطة. حاول تاني!'),
   * prevents it from ever being used again, and optionally sets the corrected answer.
   */
  public async rejectAnswer(
    query: QuestionQuery,
    wrongAnswerText: string,
    correctAnswerText?: string,
    reason?: string
  ): Promise<QuestionKnowledgeRecord> {
    const hash = QuestionNormalizer.computeQuestionHash(query.questionText, query.options);
    let record = await this.repository.findByHash(hash);

    if (!record) {
      record = {
        id: crypto.randomUUID(),
        questionHash: hash,
        normalizedText: QuestionNormalizer.normalizeArabicText(query.questionText),
        rawQuestionText: query.questionText,
        questionType: query.questionType || 'MULTIPLE_CHOICE',
        options: query.options || [],
        normalizedOptions: QuestionNormalizer.normalizeOptions(query.options || []),
        proposedAnswer: null,
        verifiedAnswer: correctAnswerText || null,
        explanation: reason || 'تم رفض الإجابة السابقة لثبوت خطئها.',
        platformName: query.platformName,
        subjectName: query.subjectName,
        lessonName: query.lessonName,
        source: 'PLATFORM_CONFIRMED',
        confidenceScore: correctAnswerText ? 1.0 : 0.0,
        verificationStatus: correctAnswerText ? 'VERIFIED' : 'REJECTED',
        occurrenceCount: 1,
        retrievalCount: 0,
        lastSeenAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } else {
      const oldAnswer = record.verifiedAnswer || record.proposedAnswer;
      const oldStatus = record.verificationStatus;

      record.verificationStatus = correctAnswerText ? 'VERIFIED' : 'REJECTED';
      record.verifiedAnswer = correctAnswerText || null;
      record.proposedAnswer = null; // Clear bad proposal
      record.confidenceScore = correctAnswerText ? 1.0 : 0.0;
      record.updatedAt = new Date();

      await this.repository.logCorrection({
        id: crypto.randomUUID(),
        questionKnowledgeId: record.id,
        oldAnswer,
        newAnswer: correctAnswerText || `[REJECTED: ${wrongAnswerText}]`,
        oldStatus,
        newStatus: record.verificationStatus,
        source: 'PLATFORM_CONFIRMED',
        reason: reason || 'رفض الإجابة الخاطئة وتسجيل التصحيح',
        createdAt: new Date(),
      });
    }

    await this.repository.upsertRecord(record);
    logger.warn(`[SmartAnswerService] Answer rejected for hash ${hash.substring(0, 8)}. Correct answer set: ${correctAnswerText || 'NONE'}`);
    return record;
  }

  /**
   * Retrieves administrative dashboard metrics
   */
  public getDashboardStats(): LearningDashboardStats {
    return this.repository.getDashboardStats();
  }

  /**
   * Smart fuzzy search through verified questions with critical word defense
   */
  private async findSmartFuzzyMatch(
    query: QuestionQuery
  ): Promise<{ record: QuestionKnowledgeRecord; similarity: number; mappedAnswer: { answerText: string; matchedOptionIndex?: number } } | null> {
    const all = await this.repository.getAllRecords({
      platform: query.platformName,
      subject: query.subjectName,
    });
    const verifiedRecords = all.filter(r => r.verificationStatus === 'VERIFIED' && r.verifiedAnswer);

    const normIncomingText = QuestionNormalizer.normalizeArabicText(query.questionText);
    const incomingOptions = query.options || [];

    for (const record of verifiedRecords) {
      // 1. Critical Word Guard: If negations or numbers differ, strictly reject!
      if (QuestionNormalizer.hasCriticalDifference(normIncomingText, record.normalizedText)) {
        continue;
      }

      // 2. Check Question Text Similarity
      const textSim = QuestionNormalizer.calculateSimilarity(normIncomingText, record.normalizedText);
      if (textSim < 0.85) {
        continue;
      }

      // 3. Check Options Bijection Matching (handles shuffled order)
      if (incomingOptions.length > 0 && record.options.length > 0) {
        const optionMatch = QuestionNormalizer.matchOptionsBijection(incomingOptions, record.options);
        if (!optionMatch.isMatch) {
          continue; // Options do not match!
        }

        // Map verified answer to current incoming options
        const mappedAnswer = this.mapAnswerToIncomingOptions(
          record.verifiedAnswer!,
          record.options,
          incomingOptions
        );

        return { record, similarity: textSim, mappedAnswer };
      } else if (textSim >= 0.95) {
        // True/False or open-ended question with very high similarity
        return {
          record,
          similarity: textSim,
          mappedAnswer: { answerText: record.verifiedAnswer! }
        };
      }
    }

    return null;
  }

  /**
   * Maps a verified answer from stored options format to incoming options format
   * (e.g. if the answer was Option C in stored, but is Option A in the new question).
   */
  private mapAnswerToIncomingOptions(
    storedAnswerText: string,
    storedOptions: string[],
    incomingOptions: string[]
  ): { answerText: string; matchedOptionIndex?: number } {
    if (!incomingOptions || incomingOptions.length === 0) {
      return { answerText: storedAnswerText };
    }

    const normStoredAnswer = QuestionNormalizer.normalizeOption(storedAnswerText);

    // Find which incoming option matches the normalized stored answer text
    let bestIncomingIdx = -1;
    let highestSim = 0.0;

    for (let i = 0; i < incomingOptions.length; i++) {
      const normIncOpt = QuestionNormalizer.normalizeOption(incomingOptions[i]);
      const sim = QuestionNormalizer.calculateSimilarity(normStoredAnswer, normIncOpt);
      if (sim > highestSim && sim >= 0.80) {
        highestSim = sim;
        bestIncomingIdx = i;
      }
    }

    if (bestIncomingIdx !== -1) {
      return {
        answerText: incomingOptions[bestIncomingIdx],
        matchedOptionIndex: bestIncomingIdx,
      };
    }

    return { answerText: storedAnswerText };
  }
}

export const smartAnswerService = new SmartAnswerService();
