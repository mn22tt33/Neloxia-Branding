import fs from 'fs';
import path from 'path';
import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';
import { 
  QuestionKnowledgeRecord, 
  QuestionCorrectionLogRecord, 
  VerificationStatus, 
  AnswerSource,
  LearningDashboardStats
} from '../types';

export class KnowledgeRepository {
  private static instance: KnowledgeRepository;
  private readonly storeFilePath: string;
  private readonly logFilePath: string;
  
  // Fast in-memory cache indexed by questionHash
  private memoryCache: Map<string, QuestionKnowledgeRecord> = new Map();
  private correctionLogs: QuestionCorrectionLogRecord[] = [];

  // Database connection circuit breaker
  private dbAvailable = true;
  private lastDbErrorTime = 0;
  private readonly DB_COOLDOWN_MS = 30000;

  // Metrics
  private stats = {
    totalQueries: 0,
    cacheHits: 0,
    aiCallsSaved: 0,
    totalResponseTimeMs: 0,
    totalCacheLatencyMs: 0,
    totalAILatencyMs: 0,
    aiQueriesCount: 0,
  };

  private constructor() {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.storeFilePath = path.join(dataDir, 'question_knowledge_store.json');
    this.logFilePath = path.join(dataDir, 'question_correction_logs.json');

    this.loadFromDisk();
  }

  public static getInstance(): KnowledgeRepository {
    if (!KnowledgeRepository.instance) {
      KnowledgeRepository.instance = new KnowledgeRepository();
    }
    return KnowledgeRepository.instance;
  }

  /**
   * Load stored records from local persistent JSON backup on startup
   */
  private loadFromDisk() {
    try {
      if (fs.existsSync(this.storeFilePath)) {
        const raw = fs.readFileSync(this.storeFilePath, 'utf8');
        const items: QuestionKnowledgeRecord[] = JSON.parse(raw);
        for (const item of items) {
          this.memoryCache.set(item.questionHash, item);
        }
        logger.info(`[KnowledgeRepository] Loaded ${items.length} questions from persistent storage.`);
      }

      if (fs.existsSync(this.logFilePath)) {
        const raw = fs.readFileSync(this.logFilePath, 'utf8');
        this.correctionLogs = JSON.parse(raw);
      }
    } catch (err: any) {
      logger.warn(`[KnowledgeRepository] Failed to read disk backup: ${err.message}`);
    }
  }

  /**
   * Persist in-memory records to disk
   */
  private saveToDisk() {
    try {
      const items = Array.from(this.memoryCache.values());
      fs.writeFileSync(this.storeFilePath, JSON.stringify(items, null, 2), 'utf8');
      fs.writeFileSync(this.logFilePath, JSON.stringify(this.correctionLogs, null, 2), 'utf8');
    } catch (err: any) {
      logger.warn(`[KnowledgeRepository] Failed to write disk backup: ${err.message}`);
    }
  }

  private shouldTryDb(): boolean {
    if (this.dbAvailable) return true;
    if (Date.now() - this.lastDbErrorTime > this.DB_COOLDOWN_MS) {
      this.dbAvailable = true;
      return true;
    }
    return false;
  }

  private handleDbFailure(err: any, opName: string) {
    this.dbAvailable = false;
    this.lastDbErrorTime = Date.now();
    logger.warn(`[KnowledgeRepository] PostgreSQL ${opName} skipped (falling back to disk): ${err.message || err}`);
  }

  /**
   * Find record by exact question hash
   */
  public async findByHash(hash: string): Promise<QuestionKnowledgeRecord | null> {
    // 1. Check in-memory cache first (instant O(1))
    const cached = this.memoryCache.get(hash);
    if (cached) {
      return cached;
    }

    // 2. Check PostgreSQL database if accessible
    if (this.shouldTryDb()) {
      try {
        if ((prisma as any).questionKnowledge?.findUnique) {
          const dbRecord = await (prisma as any).questionKnowledge.findUnique({
            where: { questionHash: hash },
          });

          if (dbRecord) {
            const mapped = this.mapFromPrisma(dbRecord);
            this.memoryCache.set(hash, mapped);
            return mapped;
          }
        }
      } catch (err: any) {
        this.handleDbFailure(err, 'findUnique');
      }
    }

    return null;
  }

  /**
   * Return all known questions (used for smart fuzzy matching)
   */
  public async getAllRecords(): Promise<QuestionKnowledgeRecord[]> {
    return Array.from(this.memoryCache.values());
  }

  /**
   * Save new or update existing question knowledge record
   */
  public async upsertRecord(record: QuestionKnowledgeRecord): Promise<QuestionKnowledgeRecord> {
    // 1. Update in-memory cache & local disk storage
    this.memoryCache.set(record.questionHash, record);
    this.saveToDisk();

    // 2. Persist to PostgreSQL if database is connected
    if (this.shouldTryDb()) {
      try {
        if ((prisma as any).questionKnowledge?.upsert) {
          await (prisma as any).questionKnowledge.upsert({
            where: { questionHash: record.questionHash },
            create: {
              id: record.id,
              questionHash: record.questionHash,
              normalizedText: record.normalizedText,
              rawQuestionText: record.rawQuestionText,
              questionType: record.questionType,
              options: record.options,
              normalizedOptions: record.normalizedOptions,
              proposedAnswer: record.proposedAnswer,
              verifiedAnswer: record.verifiedAnswer,
              explanation: record.explanation,
              platformName: record.platformName,
              subjectName: record.subjectName,
              lessonName: record.lessonName,
              source: record.source,
              confidenceScore: record.confidenceScore,
              verificationStatus: record.verificationStatus,
              occurrenceCount: record.occurrenceCount,
              retrievalCount: record.retrievalCount,
              lastSeenAt: new Date(record.lastSeenAt),
            },
            update: {
              proposedAnswer: record.proposedAnswer,
              verifiedAnswer: record.verifiedAnswer,
              explanation: record.explanation,
              source: record.source,
              confidenceScore: record.confidenceScore,
              verificationStatus: record.verificationStatus,
              occurrenceCount: record.occurrenceCount,
              retrievalCount: record.retrievalCount,
              lastSeenAt: new Date(record.lastSeenAt),
            },
          });
        }
      } catch (err: any) {
        this.handleDbFailure(err, 'upsert');
      }
    }

    return record;
  }

  /**
   * Record a correction log when an answer is changed, verified, or corrected
   */
  public async logCorrection(log: QuestionCorrectionLogRecord): Promise<void> {
    this.correctionLogs.push(log);
    this.saveToDisk();

    if (this.shouldTryDb()) {
      try {
        if ((prisma as any).questionCorrectionLog?.create) {
          await (prisma as any).questionCorrectionLog.create({
            data: {
              id: log.id,
              questionKnowledgeId: log.questionKnowledgeId,
              oldAnswer: log.oldAnswer,
              newAnswer: log.newAnswer,
              oldStatus: log.oldStatus,
              newStatus: log.newStatus,
              source: log.source,
              reason: log.reason,
            },
          });
        }
      } catch (err: any) {
        this.handleDbFailure(err, 'logCorrection');
      }
    }
  }

  /**
   * Record metrics for dashboard
   */
  public recordQueryMetrics(isHit: boolean, latencyMs: number) {
    this.stats.totalQueries++;
    this.stats.totalResponseTimeMs += latencyMs;

    if (isHit) {
      this.stats.cacheHits++;
      this.stats.aiCallsSaved++;
      this.stats.totalCacheLatencyMs += latencyMs;
    } else {
      this.stats.aiQueriesCount++;
      this.stats.totalAILatencyMs += latencyMs;
    }
  }

  /**
   * Get learning dashboard statistics
   */
  public getDashboardStats(): LearningDashboardStats {
    const all = Array.from(this.memoryCache.values());
    const totalQuestions = all.length;
    const verifiedQuestions = all.filter(q => q.verificationStatus === 'VERIFIED').length;
    const pendingQuestions = all.filter(q => q.verificationStatus === 'PENDING').length;
    const rejectedQuestions = all.filter(q => q.verificationStatus === 'REJECTED').length;

    const repetitionRate = this.stats.totalQueries > 0
      ? Number(((this.stats.cacheHits / this.stats.totalQueries) * 100).toFixed(2))
      : 0;

    const avgResponseTimeMs = this.stats.totalQueries > 0
      ? Number((this.stats.totalResponseTimeMs / this.stats.totalQueries).toFixed(2))
      : 0;

    const avgCacheLatencyMs = this.stats.cacheHits > 0
      ? Number((this.stats.totalCacheLatencyMs / this.stats.cacheHits).toFixed(2))
      : 0;

    const avgAILatencyMs = this.stats.aiQueriesCount > 0
      ? Number((this.stats.totalAILatencyMs / this.stats.aiQueriesCount).toFixed(2))
      : 0;

    return {
      totalQuestions,
      verifiedQuestions,
      pendingQuestions,
      rejectedQuestions,
      cacheHits: this.stats.cacheHits,
      totalQueries: this.stats.totalQueries,
      repetitionRate,
      avgResponseTimeMs,
      avgCacheLatencyMs,
      avgAILatencyMs,
      aiCallsSaved: this.stats.aiCallsSaved,
    };
  }

  /**
   * Reset stats (useful for tests)
   */
  public resetStats() {
    this.stats = {
      totalQueries: 0,
      cacheHits: 0,
      aiCallsSaved: 0,
      totalResponseTimeMs: 0,
      totalCacheLatencyMs: 0,
      totalAILatencyMs: 0,
      aiQueriesCount: 0,
    };
  }

  /**
   * Reload from disk (simulates server restart)
   */
  public reloadFromDisk() {
    this.memoryCache.clear();
    this.correctionLogs = [];
    this.loadFromDisk();
  }

  /**
   * Clear all memory and disk data (for tests)
   */
  public clearAll() {
    this.memoryCache.clear();
    this.correctionLogs = [];
    this.resetStats();
    this.saveToDisk();
  }

  private mapFromPrisma(db: any): QuestionKnowledgeRecord {
    return {
      id: db.id,
      questionHash: db.questionHash,
      normalizedText: db.normalizedText,
      rawQuestionText: db.rawQuestionText,
      questionType: db.questionType,
      options: Array.isArray(db.options) ? db.options : [],
      normalizedOptions: Array.isArray(db.normalizedOptions) ? db.normalizedOptions : [],
      proposedAnswer: db.proposedAnswer,
      verifiedAnswer: db.verifiedAnswer,
      explanation: db.explanation,
      platformName: db.platformName,
      subjectName: db.subjectName,
      lessonName: db.lessonName,
      source: db.source,
      confidenceScore: db.confidenceScore,
      verificationStatus: db.verificationStatus,
      occurrenceCount: db.occurrenceCount,
      retrievalCount: db.retrievalCount,
      lastSeenAt: db.lastSeenAt,
      createdAt: db.createdAt,
      updatedAt: db.updatedAt,
    };
  }
}

export const knowledgeRepository = KnowledgeRepository.getInstance();
