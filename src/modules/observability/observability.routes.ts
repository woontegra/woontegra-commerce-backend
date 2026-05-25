import { Router } from 'express';
import { getAlerts, getLogs, getMetrics, postRetry } from './observability.controller';

const router = Router();

router.get('/logs', getLogs);
router.get('/alerts', getAlerts);
router.get('/metrics', getMetrics);
router.post('/retry', postRetry);

export default router;
