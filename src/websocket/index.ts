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

    // JWT Authentication Middleware for WebSockets
    this.io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace('Bearer ', '');

        if (!token) {
          return next(new Error('Authentication error: Missing token'));
        }

        const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, email: true, role: true, status: true },
        });

        if (!user || user.status !== 'ACTIVE') {
          return next(new Error('Authentication error: Invalid or inactive user'));
        }

        (socket as any).user = user;
        next();
      } catch (err: any) {
        return next(new Error(`Authentication failed: ${err.message}`));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      const user = (socket as any).user;
      logger.info(`WebSocket client connected: ${socket.id} (User: ${user.id})`);

      // Track socket for user
      if (!this.userSockets.has(user.id)) {
        this.userSockets.set(user.id, new Set());
      }
      this.userSockets.get(user.id)?.add(socket.id);

      // Join user specific room
      socket.join(`user:${user.id}`);

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
}

export const wsManager = new WebSocketManager();
