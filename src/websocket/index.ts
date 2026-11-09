import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';
import { JwtPayload } from '../types';

export class WebSocketManager {
  private io: SocketIOServer | null = null;
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> socketIds

  public initialize(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    // Authentication Middleware for WebSockets (Supports Admin JWT and Student Session ID)
    this.io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace('Bearer ', '');

        const sessionId =
          socket.handshake.auth?.sessionId ||
          socket.handshake.query?.sessionId as string;

        if (token) {
          try {
            const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
            const user = await prisma.user.findUnique({
              where: { id: decoded.userId },
              select: { id: true, email: true, role: true, status: true },
            });

            if (user && user.status === 'ACTIVE') {
              (socket as any).user = user;
              return next();
            }
          } catch {
            // Token invalid, fall back to checking sessionId if provided
          }
        }

        // Student Session Connection (QUREO Frontend)
        if (sessionId) {
          (socket as any).studentSessionId = sessionId;
          return next();
        }

        return next(new Error('Authentication error: Missing token or session ID'));
      } catch (err: any) {
        return next(new Error(`Authentication failed: ${err.message}`));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      const user = (socket as any).user;
      const studentSessionId = (socket as any).studentSessionId;

      if (studentSessionId) {
        // Automatically join the student's isolated session room
        socket.join(`session:${studentSessionId}`);
        logger.info(`Student WebSocket connected: ${socket.id} -> session:${studentSessionId}`);
        socket.emit('session:subscribed', { sessionId: studentSessionId });
      } else if (user) {
        logger.info(`WebSocket client connected: ${socket.id} (User: ${user.id})`);

        // Track socket for user
        if (!this.userSockets.has(user.id)) {
          this.userSockets.set(user.id, new Set());
        }
        this.userSockets.get(user.id)?.add(socket.id);

        // Join user specific room
        socket.join(`user:${user.id}`);
      }

      // Client subscribes to session updates with ownership check
      socket.on('session:subscribe', async (data: { sessionId: string }) => {
        try {
          const session = await prisma.browserSession.findUnique({
            where: { id: data.sessionId },
          });

          if (!session || (session.userId !== user.id && user.role !== 'ADMIN')) {
            socket.emit('error', { message: 'Unauthorized session subscription' });
            return;
          }

          socket.join(`session:${data.sessionId}`);
          socket.emit('session:subscribed', { sessionId: data.sessionId });
          logger.info(`Socket ${socket.id} joined room session:${data.sessionId}`);
        } catch (err: any) {
          socket.emit('error', { message: err.message });
        }
      });

      socket.on('session:unsubscribe', (data: { sessionId: string }) => {
        socket.leave(`session:${data.sessionId}`);
      });

      socket.on('disconnect', () => {
        logger.info(`WebSocket client disconnected: ${socket.id}`);
        this.userSockets.get(user.id)?.delete(socket.id);
        if (this.userSockets.get(user.id)?.size === 0) {
          this.userSockets.delete(user.id);
        }
      });
    });
  }

  /**
   * Broadcast browser status change to session room
   */
  public emitBrowserStatus(sessionId: string, status: string, details?: any) {
    if (!this.io) return;
    this.io.to(`session:${sessionId}`).emit('browser:status', {
      sessionId,
      status,
      timestamp: new Date().toISOString(),
      details,
    });
  }

  public emitBrowserStarted(sessionId: string, details: any) {
    if (!this.io) return;
    this.io.to(`session:${sessionId}`).emit('browser:started', {
      sessionId,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  public emitBrowserStopped(sessionId: string) {
    if (!this.io) return;
    this.io.to(`session:${sessionId}`).emit('browser:stopped', {
      sessionId,
      timestamp: new Date().toISOString(),
    });
  }

  public emitBrowserError(sessionId: string, error: string) {
    if (!this.io) return;
    this.io.to(`session:${sessionId}`).emit('browser:error', {
      sessionId,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  public emitQuestionDetected(sessionId: string, question: any) {
    if (!this.io) return;
    this.io.to(`session:${sessionId}`).emit('question:detected', {
      sessionId,
      question,
      timestamp: new Date().toISOString(),
    });
  }

  public emitQuestionAnalyzed(sessionId: string, answer: any) {
    if (!this.io) return;
    this.io.to(`session:${sessionId}`).emit('question:analyzed', {
      sessionId,
      answer,
      timestamp: new Date().toISOString(),
    });
  }

  public emitAIAnswer(sessionId: string, answerData: any) {
    if (!this.io) return;
    this.io.to(`session:${sessionId}`).emit('ai:answer', {
      sessionId,
      ...answerData,
      timestamp: new Date().toISOString(),
    });
  }

  public emitTaskProgress(sessionId: string, step: string, percent: number) {
    if (!this.io) return;
    this.io.to(`session:${sessionId}`).emit('task:progress', {
      sessionId,
      step,
      percent,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast real-time terminal log to the student session
   */
  public emitTerminalLog(
    sessionId: string,
    log: {
      level: 'info' | 'success' | 'warn' | 'error';
      message: string;
      chapterName?: string;
      percent?: number;
      stats?: any;
    }
  ) {
    if (!this.io) return;
    this.io.to(`session:${sessionId}`).emit('terminal:log', {
      sessionId,
      ...log,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast curriculum / chapters updates to session
   */
  public emitChapterUpdate(sessionId: string, chapters: any[], stats?: any) {
    if (!this.io) return;
    this.io.to(`session:${sessionId}`).emit('chapters:update', {
      sessionId,
      chapters,
      stats,
      timestamp: new Date().toISOString(),
    });
  }
}

export const wsManager = new WebSocketManager();
