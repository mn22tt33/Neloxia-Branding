import dotenv from 'dotenv';
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:4000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  jwt: {
    secret: process.env.JWT_SECRET || 'fallback-secret-for-dev-environment-min-32-chars',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  encryptionKey: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',

  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/smart_solver?schema=public',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  ai: {
    provider: (process.env.AI_PROVIDER || 'gemini') as 'gemini' | 'openai' | 'anthropic' | 'mock',
    apiKey: process.env.AI_API_KEY || '',
    modelName: process.env.AI_MODEL_NAME || 'gemini-1.5-flash',
    baseUrl: process.env.AI_BASE_URL || '',
  },

  browser: {
    mode: (process.env.BROWSER_MODE || 'local').toLowerCase() as 'local' | 'production',
    spxBaseUrl: process.env.SPX_BASE_URL || 'https://egy.app.spx-learning-square.com/',
    displayBase: parseInt(process.env.DISPLAY_BASE || '100', 10),
    vncPortBase: parseInt(process.env.VNC_PORT_BASE || '5900', 10),
    novncPortBase: parseInt(process.env.NOVNC_PORT_BASE || '6080', 10),
    novncPublicBaseUrl: process.env.NOVNC_PUBLIC_BASE_URL || 'http://localhost',
    allowedDomains: (process.env.ALLOWED_DOMAINS || 'example.com,education.gov,khanacademy.org,coursera.org,quizlet.com,wikipedia.org,egy.app.spx-learning-square.com,spx-learning-square.com')
      .split(',')
      .map((d) => d.trim().toLowerCase()),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },
};
