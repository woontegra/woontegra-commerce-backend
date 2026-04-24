import { Router } from 'express';
import { ApiTokenController } from '../controllers/apiToken.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication to all API routes
router.use(authenticateToken);

// API Token Management
router.get('/tokens', ApiTokenController.getApiTokens);
router.post('/tokens', ApiTokenController.createApiToken);
router.put('/tokens/:id', ApiTokenController.updateApiToken);
router.patch('/tokens/:id/revoke', ApiTokenController.revokeApiToken);
router.delete('/tokens/:id', ApiTokenController.deleteApiToken);
router.post('/tokens/reset-usage', ApiTokenController.resetTokenUsage);
router.get('/tokens/stats', ApiTokenController.getTokenStats);

export default router;
