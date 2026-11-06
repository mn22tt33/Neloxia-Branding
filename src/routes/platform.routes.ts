import { Router } from 'express';
import { platformController } from '../controllers/platform.controller';
import { authenticate, authorizeRoles } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { auditLog } from '../middleware/audit';
import { platformCreateSchema } from '../validators';

const router = Router();

router.get('/', authenticate, platformController.getPlatforms);

router.post(
  '/',
  authenticate,
  authorizeRoles('ADMIN'),
  validateBody(platformCreateSchema),
  auditLog('CREATE_EDUCATIONAL_PLATFORM'),
  platformController.createPlatform
);

export default router;
