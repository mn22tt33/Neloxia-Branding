import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';

export class PlatformController {
  /**
   * List all available platforms
   */
  public async getPlatforms(req: Request, res: Response) {
    try {
      const platforms = await prisma.educationalPlatform.findMany({
        orderBy: { name: 'asc' },
      });

      return res.json({
        success: true,
        data: { platforms },
      });
    } catch (err: any) {
      logger.error(`Error fetching platforms: ${err.message}`);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Register a new educational platform (Admins only)
   */
  public async createPlatform(req: Request, res: Response) {
    try {
      const { name, baseUrl, loginUrl, status } = req.body;

      const platform = await prisma.educationalPlatform.create({
        data: {
          name,
          baseUrl,
          loginUrl,
          status: status || 'ACTIVE',
        },
      });

      return res.status(201).json({
        success: true,
        message: 'Educational platform added successfully',
        data: { platform },
      });
    } catch (err: any) {
      logger.error(`Error creating platform: ${err.message}`);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

export const platformController = new PlatformController();
