import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { QuestionNormalizer } from './normalizer';
import { telegramService } from '../services/telegram.service';

export interface MissingQuestionRecord {
  id: string;
  questionHash: string;
  questionText: string;
  normalizedText: string;
  options: string[];
  platformName?: string;
  subjectName?: string;
  lessonName?: string;
  orderId?: string;
  occurrenceCount: number;
  status: 'PENDING_ADMIN_ANSWER' | 'RESOLVED';
  firstSeenAt: string;
  lastSeenAt: string;
}

export class MissingQuestionService {
  private static instance: MissingQuestionService;
  private readonly filePath: string;
  private memoryMap: Map<string, MissingQuestionRecord> = new Map();

  private constructor() {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = path.join(dataDir, 'missing_questions_store.json');
    this.loadFromDisk();
  }

  public static getInstance(): MissingQuestionService {
    if (!MissingQuestionService.instance) {
      MissingQuestionService.instance = new MissingQuestionService();
    }
    return MissingQuestionService.instance;
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const list: MissingQuestionRecord[] = JSON.parse(raw);
        for (const item of list) {
          this.memoryMap.set(item.questionHash, item);
        }
        logger.info(`[MissingQuestionService] Loaded ${list.length} missing questions from persistent storage.`);
      }
    } catch (err: any) {
      logger.warn(`[MissingQuestionService] Failed to load disk store: ${err.message}`);
    }
  }

  private saveToDisk() {
    try {
      const list = Array.from(this.memoryMap.values());
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (err: any) {
      logger.error(`[MissingQuestionService] Failed to save to disk: ${err.message}`);
    }
  }

  /**
   * Log an unverified / missing question encountered during student session
   */
  public async recordMissingQuestion(data: {
    questionText: string;
    options: string[];
    platformName?: string;
    subjectName?: string;
    lessonName?: string;
    orderId?: string;
  }): Promise<MissingQuestionRecord> {
    const hash = QuestionNormalizer.computeQuestionHash(data.questionText, data.options);
    const existing = this.memoryMap.get(hash);

    if (existing) {
      existing.occurrenceCount += 1;
      existing.lastSeenAt = new Date().toISOString();
      if (data.orderId) existing.orderId = data.orderId;
      this.saveToDisk();
      return existing;
    }

    const newRecord: MissingQuestionRecord = {
      id: crypto.randomUUID(),
      questionHash: hash,
      questionText: data.questionText.trim(),
      normalizedText: QuestionNormalizer.normalizeArabicText(data.questionText),
      options: data.options,
      platformName: data.platformName || 'SPX / QUREO',
      subjectName: data.subjectName || 'عام',
      lessonName: data.lessonName,
      orderId: data.orderId,
      occurrenceCount: 1,
      status: 'PENDING_ADMIN_ANSWER',
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    this.memoryMap.set(hash, newRecord);
    this.saveToDisk();

    logger.info(`[MissingQuestionService] Captured missing question [${hash.substring(0, 8)}]: "${data.questionText.substring(0, 40)}..."`);

    // Notify Telegram Admin
    telegramService.notifyMissingQuestion({
      questionText: data.questionText,
      options: data.options,
      subjectName: data.subjectName,
      orderId: data.orderId,
    }).catch(() => {});

    return newRecord;
  }

  public getAll(): MissingQuestionRecord[] {
    return Array.from(this.memoryMap.values()).sort(
      (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
    );
  }

  public getPending(): MissingQuestionRecord[] {
    return this.getAll().filter((q) => q.status === 'PENDING_ADMIN_ANSWER');
  }

  public markResolved(hash: string): boolean {
    const item = this.memoryMap.get(hash);
    if (!item) return false;
    item.status = 'RESOLVED';
    this.saveToDisk();
    return true;
  }

  public delete(id: string): boolean {
    for (const [hash, item] of this.memoryMap.entries()) {
      if (item.id === id) {
        this.memoryMap.delete(hash);
        this.saveToDisk();
        return true;
      }
    }
    return false;
  }
}

export const missingQuestionService = MissingQuestionService.getInstance();
