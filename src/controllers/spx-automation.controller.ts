import { Request, Response } from 'express';
import { spxAutomationService } from '../services/spx-automation.service';
import { logger } from '../utils/logger';

export class SPXAutomationController {
  /**
   * Health check endpoint for QUREO frontend to verify backend connection
   */
  public async getHealth(req: Request, res: Response) {
    return res.json({
      success: true,
      status: 'healthy',
      service: 'QUERO Solver Multi-Student Engine',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Start a new isolated multi-student session
   */
  public async startSession(req: Request, res: Response) {
    try {
      const { studentId, password, subjectUrl, maxLessons } = req.body;

      if (!studentId || typeof studentId !== 'string' || !studentId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'كود الطالب مطلوب (Student ID is required)',
        });
      }

      if (!password || typeof password !== 'string' || !password.trim()) {
        return res.status(400).json({
          success: false,
          message: 'كلمة المرور مطلوبة (Password is required)',
        });
      }

      const result = await spxAutomationService.startSession(
        studentId.trim(),
        password.trim(),
        {
          subjectUrl,
          maxLessons: maxLessons ? parseInt(maxLessons, 10) : 10,
        }
      );

      return res.status(200).json({
        success: true,
        message: 'تم إنشاء جلسة الطالب المعزولة وبدء المعالجة الذكية بنجاح.',
        data: {
          sessionId: result.sessionId,
        },
      });
    } catch (err: any) {
      logger.error(`Failed to start SPX session: ${err.message}`);
      return res.status(500).json({
        success: false,
        message: err.message || 'حدث خطأ أثناء بدء الجلسة',
      });
    }
  }

  /**
   * Stop an active session
   */
  public async stopSession(req: Request, res: Response) {
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ success: false, message: 'معرف الجلسة مطلوب' });
      }

      const stopped = await spxAutomationService.stopSession(sessionId);
      if (!stopped) {
        return res.status(404).json({ success: false, message: 'الجلسة غير موجودة أو متوقفة بالفعل' });
      }

      return res.json({
        success: true,
        message: 'تم إيقاف جلسة المعالجة بنجاح.',
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Get current state of a session
   */
  public async getSessionStatus(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      const state = spxAutomationService.getSessionState(sessionId);

      if (!state) {
        return res.status(404).json({
          success: false,
          message: 'لم يتم العثور على الجلسة المحددة',
        });
      }

      return res.json({
        success: true,
        data: { session: state },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Subscribe to Server-Sent Events (SSE) live stream
   */
  public streamLogs(req: Request, res: Response) {
    const { sessionId } = req.params;
    spxAutomationService.subscribeSSE(sessionId, res);
  }

  /**
   * Get server logs and error history
   */
  public getServerLogs(req: Request, res: Response) {
    const logs = spxAutomationService.getAllRecentLogs();
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      activeSessionsCount: logs.length,
      data: { sessions: logs },
    });
  }
}

export const spxAutomationController = new SPXAutomationController();
