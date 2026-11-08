import { Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { encryptCredentials, decryptCredentials } from '../utils/crypto';
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

  /**
   * Get student saved platform accounts
   */
  public async getStudentAccounts(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const accounts = await prisma.studentPlatformAccount.findMany({
        where: { userId },
        include: {
          platform: {
            select: { id: true, name: true, baseUrl: true, loginUrl: true },
          },
        },
      });

      return res.json({
        success: true,
        data: {
          accounts: accounts.map((acc) => ({
            id: acc.id,
            platformId: acc.platformId,
            platformName: acc.platform.name,
            credentialsReference: acc.credentialsReference,
            hasSavedPassword: !!acc.encryptedCredentials,
            createdAt: acc.createdAt,
            updatedAt: acc.updatedAt,
          })),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Save / update student account credentials for a platform (AES-256-GCM encrypted)
   */
  public async saveStudentAccount(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { platformId, username, password } = req.body;

      const encrypted = encryptCredentials(JSON.stringify({ username, password }));

      const account = await prisma.studentPlatformAccount.upsert({
        where: {
          userId_platformId: { userId, platformId },
        },
        update: {
          encryptedCredentials: encrypted,
          credentialsReference: username,
        },
        create: {
          userId,
          platformId,
          encryptedCredentials: encrypted,
          credentialsReference: username,
        },
      });

      return res.status(201).json({
        success: true,
        message: 'Platform credentials securely saved',
        data: {
          id: account.id,
          platformId: account.platformId,
          credentialsReference: account.credentialsReference,
        },
      });
    } catch (err: any) {
      logger.error(`Error saving student account: ${err.message}`);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Remove saved credentials for a platform
   */
  public async deleteStudentAccount(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { platformId } = req.params;

      await prisma.studentPlatformAccount.deleteMany({
        where: { userId, platformId },
      });

      return res.json({
        success: true,
        message: 'Platform credentials removed successfully',
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

export const platformController = new PlatformController();
