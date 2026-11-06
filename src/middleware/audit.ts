import { Request, Response, NextFunction } from 'express';
import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';

export function auditLog(action: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Record audit after response is finalized
    res.on('finish', async () => {
      if (res.statusCode < 400) {
        try {
          const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
          const userId = req.user?.id || null;

          // Mask sensitive values from metadata
          const safeBody = { ...req.body };
          if (safeBody.password) safeBody.password = '***';
          if (safeBody.oldPassword) safeBody.oldPassword = '***';
          if (safeBody.newPassword) safeBody.newPassword = '***';
          if (safeBody.credentials) safeBody.credentials = '***';

          await prisma.auditLog.create({
            data: {
              userId,
              action,
              ipAddress: ipAddress.slice(0, 45),
              metadata: {
                path: req.originalUrl,
                method: req.method,
                statusCode: res.statusCode,
                body: Object.keys(safeBody).length > 0 ? safeBody : undefined,
                params: req.params,
              },
            },
          });
        } catch (err: any) {
          logger.error(`Failed to write audit log: ${err.message}`);
        }
      }
    });

    next();
  };
}
