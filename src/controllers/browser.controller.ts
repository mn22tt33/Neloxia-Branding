import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { browserService } from '../browser/service';
import { encryptCredentials } from '../utils/crypto';
import { logger } from '../utils/logger';

export class BrowserController {
  /**
   * Start a new isolated browser session for the user
   */
  public async startSession(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { platformId, targetUrl, credentials, saveCredentials } = req.body;

      // 1. Verify Platform exists
      const platform = await prisma.educationalPlatform.findUnique({
        where: { id: platformId },
      });

      if (!platform) {
        return res.status(404).json({ success: false, message: 'Educational platform not found' });
      }

      // 2. Encrypt credentials if student requested persistence
      if (saveCredentials && credentials) {
        const encrypted = encryptCredentials(JSON.stringify(credentials));
        await prisma.studentPlatformAccount.upsert({
          where: {
            userId_platformId: { userId, platformId },
          },
          update: {
            encryptedCredentials: encrypted,
            credentialsReference: credentials.username,
          },
          create: {
            userId,
            platformId,
            encryptedCredentials: encrypted,
            credentialsReference: credentials.username,
          },
        });
      }

      // 3. Create BrowserSession record
      const session = await prisma.browserSession.create({
        data: {
          userId,
          platformId,
          sessionStatus: 'INITIALIZING',
          browserStatus: 'LAUNCHING',
        },
      });

      const effectiveUrl = targetUrl || platform.loginUrl || platform.baseUrl;

      // 4. Launch browser asynchronously / await readiness
      const activeCtx = await browserService.startSession(
        session.id,
        userId,
        effectiveUrl,
        credentials
      );

      return res.status(201).json({
        success: true,
        message: 'Browser session started successfully',
        data: {
          sessionId: session.id,
          status: activeCtx.status,
          liveStreamUrl: activeCtx.vncUrl,
          targetUrl: effectiveUrl,
        },
      });
    } catch (err: any) {
      logger.error(`Error starting browser session: ${err.message}`);
      return res.status(500).json({ success: false, message: err.message || 'Failed to start browser session' });
    }
  }

  /**
   * Get all sessions for authenticated user
   */
  public async getSessions(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const isAdmin = req.user!.role === 'ADMIN';

      const sessions = await prisma.browserSession.findMany({
        where: isAdmin ? {} : { userId },
        include: {
          platform: { select: { id: true, name: true, baseUrl: true } },
          questions: { select: { id: true, questionText: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({
        success: true,
        data: { sessions },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Get session details with ownership verification
   */
  public async getSessionById(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      const session = await prisma.browserSession.findUnique({
        where: { id },
        include: {
          platform: true,
          events: { orderBy: { createdAt: 'desc' }, take: 20 },
          questions: {
            include: { suggestedAnswers: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!session) {
        return res.status(404).json({ success: false, message: 'Session not found' });
      }

      if (session.userId !== userId && req.user!.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Access denied to this session' });
      }

      const active = browserService.getSession(id);

      return res.json({
        success: true,
        data: {
          session,
          liveStreamUrl: active?.vncUrl || null,
          isActive: !!active,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Stop browser session
   */
  public async stopSession(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      const session = await prisma.browserSession.findUnique({ where: { id } });
      if (!session) {
        return res.status(404).json({ success: false, message: 'Session not found' });
      }

      if (session.userId !== userId && req.user!.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      await browserService.terminateSession(id, 'STOPPED');

      return res.json({
        success: true,
        message: 'Browser session stopped successfully',
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Restart browser session
   */
  public async restartSession(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      const session = await prisma.browserSession.findUnique({
        where: { id },
        include: { platform: true },
      });

      if (!session) {
        return res.status(404).json({ success: false, message: 'Session not found' });
      }

      if (session.userId !== userId && req.user!.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      // Terminate any active process first
      await browserService.terminateSession(id, 'STOPPED');

      // Restart session
      const targetUrl = session.platform.loginUrl || session.platform.baseUrl;
      const activeCtx = await browserService.startSession(id, userId, targetUrl);

      return res.json({
        success: true,
        message: 'Browser session restarted successfully',
        data: {
          sessionId: id,
          liveStreamUrl: activeCtx.vncUrl,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}

export const browserController = new BrowserController();
