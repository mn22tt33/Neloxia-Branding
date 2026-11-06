import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { auditLog } from '../middleware/audit';
import { registerSchema, loginSchema } from '../validators';

const router = Router();

router.post(
  '/register',
  validateBody(registerSchema),
  auditLog('USER_REGISTER'),
  authController.register
);

router.post(
  '/login',
  validateBody(loginSchema),
  auditLog('USER_LOGIN'),
  authController.login
);

router.post(
  '/logout',
  authenticate,
  auditLog('USER_LOGOUT'),
  authController.logout
);

router.get(
  '/me',
  authenticate,
  authController.getMe
);

export default router;
