import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { aiService } from '../ai';
import { logger } from '../utils/logger';

export class AIController {
  /**
   * Direct AI question analysis API
   */
  public async analyze(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { questionText, options, imageData } = req.body;

      const result = await aiService.solveQuestion(userId, {
        questionText,
        options,
        imageData,
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      logger.error(`Direct AI analyze error: ${err.message}`);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Get user AI usage metrics and logs
   */
  public async getUsage(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const isAdmin = req.user!.role === 'ADMIN';

      const usage = await (prisma as any).aiUsage.findMany({
        where: isAdmin ? {} : { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      const totalTokens = usage.reduce(
        (acc: { input: number; output: number }, curr: any) => ({
          input: acc.input + curr.inputTokens,
          output: acc.output + curr.outputTokens,
        }),
        { input: 0, output: 0 }
      );

      return res.json({
        success: true,
        data: {
          totalRequests: usage.length,
          totalTokens,
          history: usage,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

export const aiController = new AIController();
