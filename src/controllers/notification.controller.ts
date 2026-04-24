import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

// Schema validation
const createNotificationSchema = z.object({
  type: z.string(),
  title: z.string(),
  message: z.string(),
  data: z.any().optional(),
  isImportant: z.boolean().default(false),
});

export class NotificationController {
  // Get all notifications for user
  static async getNotifications(req: Request, res: Response) {
    try {
      const { page = 1, limit = 50, type, isRead } = req.query;
      const userId = req.user?.id;

      const where: any = {};

      if (type) where.type = type;
      if (isRead !== undefined) where.isRead = isRead === 'true';

      const skip = (Number(page) - 1) * Number(limit);

      const [notifications, total, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: { createdAt: 'desc' },
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { isRead: false } }),
      ]);

      res.json({
        success: true,
        data: notifications,
        meta: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
          unreadCount,
        },
      });
    } catch (error) {
      console.error('Get notifications error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch notifications',
      });
    }
  }

  // Create notification
  static async createNotification(req: Request, res: Response) {
    try {
      const validatedData = createNotificationSchema.parse(req.body);
      
      const notification = await prisma.notification.create({
        data: {
          ...validatedData,
          createdAt: new Date(),
        },
      });

      res.status(201).json({
        success: true,
        data: notification,
      });
    } catch (error) {
      console.error('Create notification error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create notification',
      });
    }
  }

  // Mark notification as read
  static async markAsRead(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const notification = await prisma.notification.findUnique({
        where: { id },
      });

      if (!notification) {
        return res.status(404).json({
          success: false,
          error: 'Notification not found',
        });
      }

      const updated = await prisma.notification.update({
        where: { id },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      console.error('Mark notification as read error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to mark notification as read',
      });
    }
  }

  // Mark all notifications as read
  static async markAllAsRead(req: Request, res: Response) {
    try {
      const { type } = req.query;

      const where: any = { isRead: false };
      if (type) where.type = type;

      const result = await prisma.notification.updateMany({
        where,
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: `Marked ${result.count} notifications as read`,
        updatedCount: result.count,
      });
    } catch (error) {
      console.error('Mark all notifications as read error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to mark all notifications as read',
      });
    }
  }

  // Delete notification
  static async deleteNotification(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const notification = await prisma.notification.findUnique({
        where: { id },
      });

      if (!notification) {
        return res.status(404).json({
          success: false,
          error: 'Notification not found',
        });
      }

      await prisma.notification.delete({
        where: { id },
      });

      res.json({
        success: true,
        message: 'Notification deleted successfully',
      });
    } catch (error) {
      console.error('Delete notification error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete notification',
      });
    }
  }

  // Clear all notifications
  static async clearNotifications(req: Request, res: Response) {
    try {
      const { type, isRead } = req.query;

      const where: any = {};

      if (type) where.type = type;
      if (isRead !== undefined) where.isRead = isRead === 'true';

      const result = await prisma.notification.deleteMany({ where });

      res.json({
        success: true,
        message: `Cleared ${result.count} notifications`,
        deletedCount: result.count,
      });
    } catch (error) {
      console.error('Clear notifications error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear notifications',
      });
    }
  }

  // Get notification statistics
  static async getNotificationStats(req: Request, res: Response) {
    try {
      const [
        totalCount,
        unreadCount,
        readCount,
        importantCount,
        typeStats,
      ] = await Promise.all([
        prisma.notification.count(),
        prisma.notification.count({ where: { isRead: false } }),
        prisma.notification.count({ where: { isRead: true } }),
        prisma.notification.count({ where: { isImportant: true } }),
        prisma.notification.groupBy({
          by: ['type'],
          _count: true,
          orderBy: { _count: { type: 'desc' } },
        }),
      ]);

      res.json({
        success: true,
        data: {
          total: totalCount,
          unread: unreadCount,
          read: readCount,
          important: importantCount,
          readRate: totalCount > 0 ? (readCount / totalCount) * 100 : 0,
          typeStats: typeStats.map(stat => ({
            type: stat.type,
            count: stat._count,
          })),
        },
      });
    } catch (error) {
      console.error('Get notification stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch notification statistics',
      });
    }
  }
}
