import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { swaggerDocument } from './config/swagger';
import authRoutes from './routes/auth.routes';
import platformRoutes from './routes/platform.routes';
import browserRoutes from './routes/browser.routes';
import questionRoutes from './routes/question.routes';
import aiRoutes from './routes/ai.routes';
import logRoutes from './routes/log.routes';
import learningRoutes from './routes/learning.routes';
import spxAutomationRoutes from './routes/spx-automation.routes';
import orderRoutes, { packageRouter } from './routes/order.routes';
import adminRoutes from './routes/admin.routes';
import { logger } from './utils/logger';

export function createApp(): Application {
  const app = express();

  // Security Middlewares
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allows noVNC canvas and websocket if embedded
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS Configuration - Permissive for dedicated static QUREO frontends & credentials
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, server-to-server) or any static host
        callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    })
  );

  // Rate Limiter - Development resilient & skips live polling/streaming
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.env === 'development' ? 50000 : config.rateLimit.maxRequests,
    skip: (req) =>
      req.path.includes('/stream') ||
      req.path.includes('/status') ||
      req.path.includes('/health'),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: 'Too many requests from this IP, please try again later.',
    },
  });
  app.use('/api', limiter);

  // Body parser & Logging
  app.use(express.json({ limit: '10mb' })); // Support base64 screenshot uploads
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  if (process.env.NODE_ENV !== 'test') {
    app.use(
      morgan('combined', {
        stream: { write: (message) => logger.http(message.trim()) },
      })
    );
  }

  // Swagger Documentation
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

  // Health Check Endpoint (Required by Railway & Render)
  app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.env,
    });
  });

  // REST API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/platforms', platformRoutes);
  app.use('/api/browser', browserRoutes);
  app.use('/api/questions', questionRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/logs', logRoutes);
  app.use('/api/learning', learningRoutes);
  app.use('/api/v1/learning', learningRoutes);
  app.use('/api/spx', spxAutomationRoutes);
  app.use('/api/v1/spx', spxAutomationRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/packages', packageRouter);
  app.use('/api/admin', adminRoutes);

  // 404 Handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      message: `Endpoint ${req.method} ${req.originalUrl} not found`,
    });
  });

  // Global Error Handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error(`Unhandled Exception: ${err.message}`, { stack: err.stack });
    res.status(err.status || 500).json({
      success: false,
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    });
  });

  return app;
}
