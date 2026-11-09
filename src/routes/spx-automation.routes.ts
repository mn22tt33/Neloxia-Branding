import { Router } from 'express';
import { spxAutomationController } from '../controllers/spx-automation.controller';

const router = Router();

// Health check endpoint
router.get('/health', spxAutomationController.getHealth.bind(spxAutomationController));

// Server logs & errors endpoint
router.get('/logs', spxAutomationController.getServerLogs.bind(spxAutomationController));

// Start session
router.post('/start', spxAutomationController.startSession.bind(spxAutomationController));

// Stop session
router.post('/stop', spxAutomationController.stopSession.bind(spxAutomationController));

// Get session state
router.get('/status/:sessionId', spxAutomationController.getSessionStatus.bind(spxAutomationController));

// SSE live stream
router.get('/stream/:sessionId', spxAutomationController.streamLogs.bind(spxAutomationController));

export default router;
