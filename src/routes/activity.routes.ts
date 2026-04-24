import { Router } from 'express';
import { ActivityLogController } from '../controllers/activityLog.controller';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication to all activity log routes
router.use(authenticateToken);

// Activity Log Management
router.get('/', ActivityLogController.getActivityLogs);
router.post('/', ActivityLogController.createActivityLog);
router.get('/stats', ActivityLogController.getLogStats);
router.delete('/:id', requireAdmin, ActivityLogController.deleteActivityLog);
router.delete('/bulk', requireAdmin, ActivityLogController.bulkDeleteActivityLogs);

export default router;
