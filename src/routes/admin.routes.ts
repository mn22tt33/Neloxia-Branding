import { Router } from 'express';
import { adminController } from '../controllers/admin.controller';

const router = Router();

// Orders
router.get('/orders', adminController.getOrders.bind(adminController));
router.post('/orders/:orderId/approve', adminController.approveOrder.bind(adminController));
router.post('/orders/:orderId/reject', adminController.rejectOrder.bind(adminController));

// Packages
router.get('/packages', adminController.getPackages.bind(adminController));
router.post('/packages', adminController.upsertPackage.bind(adminController));

// Knowledge Base
router.get('/knowledge-base', adminController.getKnowledgeBase.bind(adminController));
router.post('/knowledge-base', adminController.addKnowledgeQuestion.bind(adminController));
router.delete('/knowledge-base/:id', adminController.deleteKnowledgeQuestion.bind(adminController));
router.get('/knowledge-base/export', adminController.exportKnowledgeBase.bind(adminController));
router.post('/knowledge-base/import', adminController.importKnowledgeBase.bind(adminController));

// Missing Questions
router.get('/missing-questions', adminController.getMissingQuestions.bind(adminController));
router.post('/missing-questions/:missingId/verify', adminController.verifyMissingQuestion.bind(adminController));

// Active Sessions
router.get('/sessions', adminController.getActiveSessions.bind(adminController));
router.post('/sessions/:sessionId/stop', adminController.stopSession.bind(adminController));

export default router;
