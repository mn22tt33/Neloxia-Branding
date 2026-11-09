import { Router } from 'express';
import { learningController } from '../controllers/learning.controller';
import { authenticate } from '../middleware/auth';
import { auditLog } from '../middleware/audit';

const router = Router();

router.get('/stats', authenticate, learningController.getStats);
router.get('/questions', authenticate, learningController.getQuestions);
router.post('/query', authenticate, auditLog('QUERY_KNOWLEDGE_BASE'), learningController.queryQuestion);
router.post('/verify', authenticate, auditLog('VERIFY_QUESTION_ANSWER'), learningController.verifyAnswer);
router.post('/reject', authenticate, auditLog('REJECT_QUESTION_ANSWER'), learningController.rejectAnswer);

export default router;
