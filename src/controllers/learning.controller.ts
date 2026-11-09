import { Request, Response } from 'express';
import { smartAnswerService } from '../ai/smart-answer.service';
import { knowledgeRepository } from '../ai/knowledge.repository';
import { logger } from '../utils/logger';

export class LearningController {
  /**
   * GET /api/v1/learning/stats
   * Returns all 8 administrative dashboard metrics
   */
  public async getStats(_req: Request, res: Response): Promise<void> {
    try {
      const stats = smartAnswerService.getDashboardStats();
      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (err: any) {
      logger.error(`[LearningController] Error retrieving stats: ${err.message}`);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * GET /api/v1/learning/questions
   * Returns list of stored questions with filters
   */
  public async getQuestions(req: Request, res: Response): Promise<void> {
    try {
      const { status, platform, search } = req.query;
      let records = await knowledgeRepository.getAllRecords();

      if (status) {
        records = records.filter(r => r.verificationStatus === String(status).toUpperCase());
      }

      if (platform) {
        records = records.filter(r => r.platformName?.toLowerCase().includes(String(platform).toLowerCase()));
      }

      if (search) {
        const q = String(search).toLowerCase();
        records = records.filter(r => 
          r.rawQuestionText.toLowerCase().includes(q) || 
          r.normalizedText.toLowerCase().includes(q)
        );
      }

      res.status(200).json({
        success: true,
        count: records.length,
        data: records,
      });
    } catch (err: any) {
      logger.error(`[LearningController] Error retrieving questions: ${err.message}`);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * POST /api/v1/learning/query
   * Test or resolve question via SmartAnswerService
   */
  public async queryQuestion(req: Request, res: Response): Promise<void> {
    try {
      const { questionText, options, platformName, subjectName, lessonName } = req.body;
      if (!questionText) {
        res.status(400).json({ success: false, message: 'questionText is required' });
        return;
      }

      const result = await smartAnswerService.getAnswer({
        questionText,
        options,
        platformName,
        subjectName,
        lessonName,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      logger.error(`[LearningController] Query error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/v1/learning/verify
   * Verify an answer as trusted
   */
  public async verifyAnswer(req: Request, res: Response): Promise<void> {
    try {
      const { questionText, options, verifiedAnswer, source, explanation, reason, platformName, subjectName, lessonName } = req.body;
      if (!questionText || !verifiedAnswer) {
        res.status(400).json({ success: false, message: 'questionText and verifiedAnswer are required' });
        return;
      }

      const record = await smartAnswerService.confirmVerifiedAnswer(
        {
          questionText,
          options,
          platformName,
          subjectName,
          lessonName,
        },
        verifiedAnswer,
        source || 'TEACHER_VERIFIED',
        explanation,
        reason
      );

      res.status(200).json({
        success: true,
        message: 'Question answer verified and saved to persistent knowledge base',
        data: record,
      });
    } catch (err: any) {
      logger.error(`[LearningController] Verify error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/v1/learning/reject
   * Reject an incorrect answer and log correction
   */
  public async rejectAnswer(req: Request, res: Response): Promise<void> {
    try {
      const { questionText, options, wrongAnswer, correctAnswer, reason, platformName, subjectName, lessonName } = req.body;
      if (!questionText || !wrongAnswer) {
        res.status(400).json({ success: false, message: 'questionText and wrongAnswer are required' });
        return;
      }

      const record = await smartAnswerService.rejectAnswer(
        {
          questionText,
          options,
          platformName,
          subjectName,
          lessonName,
        },
        wrongAnswer,
        correctAnswer,
        reason
      );

      res.status(200).json({
        success: true,
        message: 'Question answer rejected and correction recorded',
        data: record,
      });
    } catch (err: any) {
      logger.error(`[LearningController] Reject error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message });
    }
  }
}

export const learningController = new LearningController();
