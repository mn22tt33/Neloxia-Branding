import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

declare global {
  // allow global `var` declarations in ts
  var prismaGlobal: PrismaClient | undefined;
}

export const prisma =
  global.prismaGlobal ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.prismaGlobal = prisma;
}

export async function connectDatabase() {
  try {
    await prisma.$connect();
    logger.info('Database connected successfully via Prisma');
  } catch (err: any) {
    logger.error(`Database connection failed: ${err.message}`);
  }
}
