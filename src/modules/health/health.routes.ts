import { Router } from 'express';
import { healthController } from './health.controller';

const router = Router();

// Health check endpoints
router.get('/health', healthController.getSimpleHealth);
router.get('/health/detailed', healthController.getHealthStatus);
router.get('/metrics', healthController.getMetrics);

export default router;
