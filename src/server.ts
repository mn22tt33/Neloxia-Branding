import http from 'http';
import { createApp } from './app';
import { config } from './config';
import { connectDatabase } from './database/prisma';
import { wsManager } from './websocket';
import { logger } from './utils/logger';

async function bootstrap() {
  const app = createApp();
  const server = http.createServer(app);

  // Initialize WebSockets attached to HTTP Server
  wsManager.initialize(server);

  // Connect to Database
  await connectDatabase();

  const PORT = config.port;
  server.listen(PORT, () => {
    logger.info(`=================================================`);
    logger.info(`  Smart Solver Backend Server Online`);
    logger.info(`  Environment : ${config.env}`);
    logger.info(`  Port        : ${PORT}`);
    logger.info(`  API Base    : http://localhost:${PORT}/api`);
    logger.info(`  Docs (UI)   : http://localhost:${PORT}/api-docs`);
    logger.info(`  Health Check: http://localhost:${PORT}/health`);
    logger.info(`=================================================`);
  });

  // Graceful shutdown
  const signals = ['SIGTERM', 'SIGINT'];
  signals.forEach((sig) => {
    process.on(sig, async () => {
      logger.info(`Received ${sig}, gracefully shutting down server...`);
      server.close(() => {
        logger.info('HTTP server closed.');
        process.exit(0);
      });
    });
  });
}

bootstrap().catch((err) => {
  logger.error(`Critical startup failure: ${err.message}`);
  process.exit(1);
});
