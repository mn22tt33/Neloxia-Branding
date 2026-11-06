import { Router } from 'express';
import { questionController } from '../controllers/question.controller';
import { authenticate } from '../middleware/auth';
import { auditLog } from '../middleware/audit';

const router = Router();

router.get('/', authenticate, questionController.getQuestions);
router.get('/:id', authenticate, questionController.getQuestionById);
router.post('/session/:sessionId/detect', authenticate, questionController.detectFromSession);
router.post(
  '/:id/analyze',
  authenticate,
  auditLog('ANALYZE_QUESTION'),
  questionController.analyzeQuestion
);

export default router;
