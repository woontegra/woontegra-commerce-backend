import { Router } from 'express';
import { NotificationsController } from './notifications.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();
const notificationsController = new NotificationsController();

// All routes require authentication
router.use(authenticate);

router.get('/', notificationsController.list.bind(notificationsController));
router.get('/unread-count', notificationsController.getUnreadCount.bind(notificationsController));
router.patch('/:id/read', notificationsController.markAsRead.bind(notificationsController));
router.post('/mark-all-read', notificationsController.markAllAsRead.bind(notificationsController));
router.delete('/:id', notificationsController.delete.bind(notificationsController));

export default router;
