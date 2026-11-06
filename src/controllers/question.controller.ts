import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { aiService } from '../ai';
import { browserService } from '../browser/service';
import { wsManager } from '../websocket';
import { logger } from '../utils/logger';

export class QuestionController {
  /**
   * List questions
   */
  public async getQuestions(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const isAdmin = req.user!.role === 'ADMIN';

      const questions = await prisma.question.findMany({
        where: isAdmin ? {} : { session: { userId } },
        include: {
          suggestedAnswers: true,
          session: { select: { id: true, platform: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({ success: true, data: { questions } });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Get single question by ID
   */
  public async getQuestionById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      const question = await prisma.question.findUnique({
        where: { id },
        include: {
          suggestedAnswers: true,
          session: true,
        },
      });

      if (!question) {
        return res.status(404).json({ success: false, message: 'Question not found' });
      }

      if (question.session.userId !== userId && req.user!.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      return res.json({ success: true, data: { question } });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Detect question directly from active browser session
   */
  public async detectFromSession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      const userId = req.user!.id;

      const session = await prisma.browserSession.findUnique({ where: { id: sessionId } });
      if (!session || (session.userId !== userId && req.user!.role !== 'ADMIN')) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const extracted = await browserService.extractQuestion(sessionId);
      if (!extracted) {
        return res.status(404).json({ success: false, message: 'No question detected on current screen' });
      }

      return res.json({
        success: true,
        message: 'Question detected from active browser screen',
        data: { question: extracted },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Analyze question with AI and suggest educational solution
   */
  public async analyzeQuestion(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      const question = await prisma.question.findUnique({
        where: { id },
        include: { session: true },
      });

      if (!question) {
        return res.status(404).json({ success: false, message: 'Question not found' });
      }

      if (question.session.userId !== userId && req.user!.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const options = Array.isArray(question.extractedOptions)
        ? (question.extractedOptions as string[])
        : undefined;

      const aiResult = await aiService.solveQuestion(
        userId,
        {
          questionText: question.questionText,
          options,
          imageData: question.questionImage || undefined,
        },
        question.id
      );

      // Broadcast to WebSocket subscribers
      wsManager.emitAIAnswer(question.sessionId, {
        questionId: question.id,
        answer: aiResult.answerText,
        confidence: aiResult.confidenceScore,
        model: aiResult.modelName,
      });

      return res.json({
        success: true,
        message: 'Question analyzed successfully',
        data: {
          questionId: question.id,
          answer: aiResult.answerText,
          confidenceScore: aiResult.confidenceScore,
          explanation: aiResult.explanation,
          aiModel: aiResult.modelName,
        },
      });
    } catch (err: any) {
      logger.error(`Error analyzing question: ${err.message}`);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}

export const questionController = new QuestionController();
