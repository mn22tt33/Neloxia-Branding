export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'AI Smart Solver Enterprise Backend API',
    version: '1.0.0',
    description: 'High-performance API for AI Smart Solver with Playwright isolation, noVNC live streaming, and pluggable AI models',
  },
  servers: [
    {
      url: '/api',
      description: 'API Base Server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        summary: 'Railway and Load Balancer Health Check',
        responses: {
          200: { description: 'Service is healthy' },
        },
      },
    },
    '/auth/register': {
      post: {
        summary: 'Register a new user account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                  password: { type: 'string' },
                  role: { type: 'string', enum: ['STUDENT', 'ADMIN'] },
                },
                required: ['name', 'email', 'password'],
              },
            },
          },
        },
        responses: {
          201: { description: 'User successfully registered' },
        },
      },
    },
    '/auth/login': {
      post: {
        summary: 'Login and obtain JWT token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  password: { type: 'string' },
                },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Login successful' },
        },
      },
    },
    '/browser/start': {
      post: {
        summary: 'Launch an isolated student browser session with noVNC live stream',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  platformId: { type: 'string', format: 'uuid' },
                  targetUrl: { type: 'string' },
                },
                required: ['platformId'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Session created and live stream URL returned' },
        },
      },
    },
    '/ai/analyze': {
      post: {
        summary: 'Analyze questions using pluggable AI engine',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  questionText: { type: 'string' },
                  options: { type: 'array', items: { type: 'string' } },
                },
                required: ['questionText'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Suggested answer and confidence score' },
        },
      },
    },
  },
};
