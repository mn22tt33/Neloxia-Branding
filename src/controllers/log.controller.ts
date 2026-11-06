import { Request, Response } from 'express';
import { prisma } from '../database/prisma';

export class LogController {
  /**
   * Fetch audit logs (Admins see all, students see their own)
   */
  public async getLogs(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const isAdmin = req.user!.role === 'ADMIN';

      const logs = await prisma.auditLog.findMany({
        where: isAdmin ? {} : { userId },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      return res.json({
        success: true,
        data: { logs },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

export const logController = new LogController();
