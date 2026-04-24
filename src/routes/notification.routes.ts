import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication to all notification routes
router.use(authenticateToken);

// Notification Management
router.get('/', NotificationController.getNotifications);
router.post('/', NotificationController.createNotification);
router.patch('/:id/read', NotificationController.markAsRead);
router.patch('/read-all', NotificationController.markAllAsRead);
router.delete('/:id', NotificationController.deleteNotification);
router.delete('/', NotificationController.clearNotifications);
router.get('/stats', NotificationController.getNotificationStats);

export default router;
