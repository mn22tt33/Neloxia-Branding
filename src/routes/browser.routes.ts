import { Router } from 'express';
import { browserController } from '../controllers/browser.controller';
import { authenticate } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { auditLog } from '../middleware/audit';
import { startBrowserSessionSchema } from '../validators';

const router = Router();

router.post(
  '/start',
  authenticate,
  validateBody(startBrowserSessionSchema),
  auditLog('START_BROWSER_SESSION'),
  browserController.startSession
);

router.get('/sessions', authenticate, browserController.getSessions);

router.get('/sessions/:id', authenticate, browserController.getSessionById);

router.post(
  '/sessions/:id/stop',
  authenticate,
  auditLog('STOP_BROWSER_SESSION'),
  browserController.stopSession
);

router.post(
  '/sessions/:id/restart',
  authenticate,
  auditLog('RESTART_BROWSER_SESSION'),
  browserController.restartSession
);

export default router;
