import { Request, Response } from 'express';
import { orderService } from '../services/order.service';
import { knowledgeRepository } from '../ai/knowledge.repository';
import { missingQuestionService } from '../ai/missing-question.service';
import { spxAutomationService } from '../services/spx-automation.service';
import { QuestionNormalizer } from '../ai/normalizer';
import { QuestionKnowledgeRecord } from '../types';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export class AdminController {
  // --- Orders Management ---

  public async getOrders(req: Request, res: Response) {
    try {
      const statusFilter = req.query.status as any;
      const orders = orderService.getAllOrders(statusFilter);
      return res.json({
        success: true,
        count: orders.length,
        data: orders,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  public async approveOrder(req: Request, res: Response) {
    try {
      const { orderId } = req.params;
      const { notes } = req.body;
      const order = await orderService.approvePayment(orderId, notes);
      return res.json({
        success: true,
        message: `تم اعتماد دفع الطلب ${order.orderId} وتفعيل الخدمة للطالب بنجاح!`,
        data: order,
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  public async rejectOrder(req: Request, res: Response) {
    try {
      const { orderId } = req.params;
      const { reason } = req.body;
      const order = await orderService.rejectPayment(orderId, reason || 'إيصال غير مطابق');
      return res.json({
        success: true,
        message: `تم رفض إيصال الطلب ${order.orderId}.`,
        data: order,
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  // --- Packages Management ---

  public async getPackages(req: Request, res: Response) {
    try {
      const packages = orderService.getAllPackages();
      return res.json({ success: true, data: packages });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  public async upsertPackage(req: Request, res: Response) {
    try {
      const pkg = orderService.upsertPackage(req.body);
      return res.json({
        success: true,
        message: 'تم حفظ وتحديث بيانات الباقة بنجاح.',
        data: pkg,
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  // --- Central Knowledge Base Management ---

  public async getKnowledgeBase(req: Request, res: Response) {
    try {
      const { search, subject, page = '1', limit = '50' } = req.query;
      const all = await knowledgeRepository.getAllRecords();

      let filtered = all;
      if (search) {
        const query = String(search).toLowerCase();
        filtered = filtered.filter(
          (q) =>
            q.rawQuestionText.toLowerCase().includes(query) ||
            q.normalizedText.toLowerCase().includes(query) ||
            (q.verifiedAnswer && q.verifiedAnswer.toLowerCase().includes(query))
        );
      }
      if (subject) {
        filtered = filtered.filter((q) => q.subjectName === subject || q.platformName === subject);
      }

      const p = parseInt(String(page), 10);
      const l = parseInt(String(limit), 10);
      const start = (p - 1) * l;
      const paginated = filtered.slice(start, start + l);

      return res.json({
        success: true,
        total: filtered.length,
        page: p,
        totalPages: Math.ceil(filtered.length / l),
        data: paginated,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  public async addKnowledgeQuestion(req: Request, res: Response) {
    try {
      const { questionText, options, verifiedAnswer, explanation, subjectName, platformName } = req.body;

      if (!questionText || !verifiedAnswer) {
        return res.status(400).json({
          success: false,
          message: 'نص السؤال والإجابة الموثقة مطلوبان.',
        });
      }

      const optList: string[] = Array.isArray(options) ? options : [verifiedAnswer];
      const hash = QuestionNormalizer.computeQuestionHash(questionText, optList);

      const record: QuestionKnowledgeRecord = {
        id: crypto.randomUUID(),
        questionHash: hash,
        rawQuestionText: questionText.trim(),
        normalizedText: QuestionNormalizer.normalizeArabicText(questionText),
        questionType: 'MULTIPLE_CHOICE',
        options: optList,
        normalizedOptions: QuestionNormalizer.normalizeOptions(optList),
        verifiedAnswer: verifiedAnswer.trim(),
        proposedAnswer: verifiedAnswer.trim(),
        explanation: explanation || 'إجابة نموذجية معتمدة وموثقة من الإدارة.',
        platformName: platformName || 'SPX / QUREO',
        subjectName: subjectName || 'عام',
        source: 'TEACHER_VERIFIED',
        confidenceScore: 1.0,
        verificationStatus: 'VERIFIED',
        occurrenceCount: 1,
        retrievalCount: 0,
        lastSeenAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await knowledgeRepository.upsertRecord(record);

      return res.status(201).json({
        success: true,
        message: 'تمت إضافة السؤال وتوثيق إجابته في قاعدة المعرفة المركزية بنجاح!',
        data: record,
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  public async deleteKnowledgeQuestion(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const deleted = await knowledgeRepository.deleteRecord(id);
      if (!deleted) {
        return res.status(404).json({ success: false, message: 'السؤال غير موجود' });
      }
      return res.json({ success: true, message: 'تم حذف السؤال من قاعدة المعرفة بنجاح.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  public async exportKnowledgeBase(req: Request, res: Response) {
    try {
      const records = await knowledgeRepository.getAllRecords();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="qureo_knowledge_base_export.json"');
      return res.send(JSON.stringify(records, null, 2));
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  public async importKnowledgeBase(req: Request, res: Response) {
    try {
      const { questions } = req.body;
      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'يجب إرسال مصفوفة أسئلة غير فارغة للاستيراد.',
        });
      }

      let importedCount = 0;
      for (const item of questions) {
        if (!item.questionText || !item.verifiedAnswer) continue;

        const optList: string[] = Array.isArray(item.options) ? item.options : [item.verifiedAnswer];
        const hash = QuestionNormalizer.computeQuestionHash(item.questionText, optList);

        const record: QuestionKnowledgeRecord = {
          id: item.id || crypto.randomUUID(),
          questionHash: hash,
          rawQuestionText: item.questionText.trim(),
          normalizedText: QuestionNormalizer.normalizeArabicText(item.questionText),
          questionType: 'MULTIPLE_CHOICE',
          options: optList,
          normalizedOptions: QuestionNormalizer.normalizeOptions(optList),
          verifiedAnswer: item.verifiedAnswer.trim(),
          proposedAnswer: item.verifiedAnswer.trim(),
          explanation: item.explanation || 'تم الاستيراد الجماعي للاختبارات الرسمية.',
          platformName: item.platformName || 'SPX / QUREO',
          subjectName: item.subjectName || 'عام',
          source: 'TEACHER_VERIFIED',
          confidenceScore: 1.0,
          verificationStatus: 'VERIFIED',
          occurrenceCount: 1,
          retrievalCount: 0,
          lastSeenAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await knowledgeRepository.upsertRecord(record);
        importedCount++;
      }

      return res.json({
        success: true,
        message: `تم استيراد واعتماد ${importedCount} سؤالاً بنجاح في قاعدة المعرفة المركزية.`,
        importedCount,
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  // --- Missing / Unmatched Questions Management ---

  public async getMissingQuestions(req: Request, res: Response) {
    try {
      const missing = missingQuestionService.getPending();
      return res.json({
        success: true,
        count: missing.length,
        data: missing,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  public async verifyMissingQuestion(req: Request, res: Response) {
    try {
      const { missingId } = req.params;
      const { verifiedAnswer, explanation } = req.body;

      if (!verifiedAnswer) {
        return res.status(400).json({ success: false, message: 'الإجابة الموثقة مطلوبة' });
      }

      const all = missingQuestionService.getAll();
      const target = all.find((q) => q.id === missingId);

      if (!target) {
        return res.status(404).json({ success: false, message: 'السؤال غير موجود في قائمة الأسئلة المعلقة' });
      }

      // Add to verified knowledge base
      const hash = QuestionNormalizer.computeQuestionHash(target.questionText, target.options);
      const record: QuestionKnowledgeRecord = {
        id: crypto.randomUUID(),
        questionHash: hash,
        rawQuestionText: target.questionText,
        normalizedText: target.normalizedText,
        questionType: 'MULTIPLE_CHOICE',
        options: target.options,
        normalizedOptions: QuestionNormalizer.normalizeOptions(target.options),
        verifiedAnswer: verifiedAnswer.trim(),
        proposedAnswer: verifiedAnswer.trim(),
        explanation: explanation || 'تم التحقق والاعتماد بواسطة الإدارة.',
        platformName: target.platformName,
        subjectName: target.subjectName,
        lessonName: target.lessonName,
        source: 'TEACHER_VERIFIED',
        confidenceScore: 1.0,
        verificationStatus: 'VERIFIED',
        occurrenceCount: target.occurrenceCount,
        retrievalCount: 0,
        lastSeenAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await knowledgeRepository.upsertRecord(record);
      missingQuestionService.markResolved(hash);

      logger.info(`[AdminController] Promoted missing question ${missingId} to VERIFIED knowledge base.`);

      return res.json({
        success: true,
        message: 'تم توثيق السؤال وإضافته لقاعدة المعرفة المركزية! أصبح متاحاً لجميع الطلاب فوراً.',
        data: record,
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  // --- Active Sessions Monitoring ---

  public async getActiveSessions(req: Request, res: Response) {
    try {
      const sessions = spxAutomationService.getAllRecentLogs();
      return res.json({
        success: true,
        count: sessions.length,
        data: sessions,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  public async stopSession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      const stopped = await spxAutomationService.stopSession(sessionId);
      if (!stopped) {
        return res.status(404).json({ success: false, message: 'الجلسة غير موجودة أو متوقفة بالفعل' });
      }
      return res.json({ success: true, message: 'تم إيقاف جلسة المتصفح بنجاح.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}

export const adminController = new AdminController();
