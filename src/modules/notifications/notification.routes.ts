import { Router } from 'express';
import { authenticate } from '../../common/middleware/authEnhanced';
import {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} from './notification.controller';

const router = Router();

router.use(authenticate);

router.get('/',              getNotifications);
router.get('/unread-count',  getUnreadCount);
router.patch('/:id/read',    markRead);
router.patch('/read-all',    markAllRead);

export default router;
