import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../database/prisma';
import { config } from '../config';
import { logger } from '../utils/logger';

export class AuthController {
  /**
   * Register a new user
   */
  public async register(req: Request, res: Response) {
    try {
      const { name, email, password, role } = req.body;

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'An account with this email already exists',
        });
      }

      // Hash password
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(password, salt);

      const user = await prisma.user.create({
        data: {
          name,
          email: email.toLowerCase(),
          passwordHash,
          role: role || 'STUDENT',
          status: 'ACTIVE',
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });

      // Generate JWT
      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn as any }
      );

      return res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user,
          token,
        },
      });
    } catch (error: any) {
      logger.error(`Registration error: ${error.message}`);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * User login
   */
  public async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }

      if (user.status !== 'ACTIVE') {
        return res.status(403).json({
          success: false,
          message: 'Your account is deactivated or suspended. Please contact support.',
        });
      }

      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }

      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn as any }
      );

      return res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status,
          },
          token,
        },
      });
    } catch (error: any) {
      logger.error(`Login error: ${error.message}`);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Get current authenticated user profile
   */
  public async getMe(req: Request, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({
        success: true,
        data: { user },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Logout user (invalidate on client, log audit)
   */
  public async logout(req: Request, res: Response) {
    return res.json({
      success: true,
      message: 'Logged out successfully',
    });
  }
}

export const authController = new AuthController();
