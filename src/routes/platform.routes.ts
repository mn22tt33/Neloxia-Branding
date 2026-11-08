import { Router } from 'express';
import { platformController } from '../controllers/platform.controller';
import { authenticate, authorizeRoles } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { auditLog } from '../middleware/audit';
import { platformCreateSchema, savePlatformAccountSchema } from '../validators';

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

// Student platform account management
router.get('/accounts', authenticate, platformController.getStudentAccounts);

router.post(
  '/accounts',
  authenticate,
  validateBody(savePlatformAccountSchema),
  auditLog('SAVE_STUDENT_PLATFORM_ACCOUNT'),
  platformController.saveStudentAccount
);

router.delete(
  '/accounts/:platformId',
  authenticate,
  auditLog('DELETE_STUDENT_PLATFORM_ACCOUNT'),
  platformController.deleteStudentAccount
);

export default router;
