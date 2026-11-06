import { Router } from 'express';
import { logController } from '../controllers/log.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, logController.getLogs);

export default router;
