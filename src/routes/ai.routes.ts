import { Router } from 'express';
import { aiController } from '../controllers/ai.controller';
import { authenticate } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { auditLog } from '../middleware/audit';
import { analyzeQuestionSchema } from '../validators';

const router = Router();

router.post(
  '/analyze',
  authenticate,
  validateBody(analyzeQuestionSchema),
  auditLog('DIRECT_AI_ANALYZE'),
  aiController.analyze
);

router.get('/usage', authenticate, aiController.getUsage);

export default router;
