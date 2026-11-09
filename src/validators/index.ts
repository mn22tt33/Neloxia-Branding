import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  role: z.enum(['STUDENT', 'ADMIN', 'INSTRUCTOR']).optional().default('STUDENT'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Old password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

export const platformCreateSchema = z.object({
  name: z.string().min(2).max(150),
  baseUrl: z.string().url('Base URL must be a valid URL'),
  loginUrl: z.string().url('Login URL must be a valid URL'),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'DISABLED']).optional().default('ACTIVE'),
});

export const startBrowserSessionSchema = z.object({
  platformId: z.string().uuid('Platform ID must be a valid UUID'),
  targetUrl: z.string().url('Target URL must be a valid URL').optional(),
  credentials: z
    .object({
      username: z.string().min(1),
      password: z.string().min(1),
    })
    .optional(),
  saveCredentials: z.boolean().optional().default(false),
});

export const savePlatformAccountSchema = z.object({
  platformId: z.string().uuid('Platform ID must be a valid UUID'),
  username: z.string().min(1, 'Username / Student Code is required'),
  password: z.string().min(1, 'Password is required'),
});

export const browserInteractSchema = z.object({
  action: z.enum(['click', 'select', 'navigate', 'type']),
  target: z.object({
    selector: z.string().optional(),
    text: z.string().optional(),
    value: z.string().optional(),
    url: z.string().url().optional(),
  }),
});

export const analyzeQuestionSchema = z.object({
  questionText: z.string().min(2, 'Question text is required'),
  questionType: z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_IN_BLANK', 'SHORT_ANSWER', 'ESSAY']).optional().default('MULTIPLE_CHOICE'),
  options: z.array(z.string()).optional(),
  imageData: z.string().optional(),
});
