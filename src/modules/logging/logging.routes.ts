import { Router } from 'express';
import { errorLoggerController } from './errorLogger.controller';

const router = Router();

// Apply authentication to all logging routes
router.use((req, res, next) => {
  const user = (req as any).user;
  if (!user || user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
});

// Log management endpoints
router.get('/logs', errorLoggerController.getLogs);
router.get('/logs/stats', errorLoggerController.getLogStats);
router.delete('/logs', errorLoggerController.clearLogs);
router.get('/logs/download', errorLoggerController.downloadLogs);

export default router;
