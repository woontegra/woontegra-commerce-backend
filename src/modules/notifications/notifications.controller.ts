import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { NotificationService } from '../../services/notification.service';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

export class NotificationsController {
  /**
   * GET /notifications
   * Get all notifications for tenant
   */
  async list(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      const { limit = '20', offset = '0' } = req.query;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const notifications = await prisma.notification.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
      });

      const unreadCount = await NotificationService.getUnreadCount(tenantId);

      return res.json({
        success: true,
        data: notifications,
        unreadCount,
      });
    } catch (error) {
      console.error('List notifications error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  /**
   * GET /notifications/unread-count
   * Get unread notification count
   */
  async getUnreadCount(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const count = await NotificationService.getUnreadCount(tenantId);

      return res.json({
        success: true,
        count,
      });
    } catch (error) {
      console.error('Get unread count error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  /**
   * PATCH /notifications/:id/read
   * Mark notification as read
   */
  async markAsRead(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      await NotificationService.markAsRead(id, tenantId);

      return res.json({
        success: true,
        message: 'Notification marked as read',
      });
    } catch (error) {
      console.error('Mark as read error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  /**
   * POST /notifications/mark-all-read
   * Mark all notifications as read
   */
  async markAllAsRead(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      await NotificationService.markAllAsRead(tenantId);

      return res.json({
        success: true,
        message: 'All notifications marked as read',
      });
    } catch (error) {
      console.error('Mark all as read error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  /**
   * DELETE /notifications/:id
   * Delete notification
   */
  async delete(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      await NotificationService.delete(id, tenantId);

      return res.json({
        success: true,
        message: 'Notification deleted',
      });
    } catch (error) {
      console.error('Delete notification error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
}
