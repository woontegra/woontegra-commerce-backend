import { PrismaClient, NotificationType } from '@prisma/client';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

export interface InAppNotificationData {
  tenantId: string;
  type:     NotificationType;
  title:    string;
  message:  string;
  data?:    Record<string, unknown>;
}

export class InAppNotificationService {
  async create(n: InAppNotificationData) {
    try {
      const notification = await prisma.notification.create({
        data: {
          tenantId: n.tenantId,
          type:     n.type,
          title:    n.title,
          message:  n.message,
          data:     n.data,
          isRead:   false,
        },
      });
      logger.info({ message: '[InApp] Notification created', id: notification.id, type: n.type, tenantId: n.tenantId });
      return notification;
    } catch (err) {
      logger.error({ message: '[InApp] Failed to create notification', err });
    }
  }

  async getUnread(tenantId: string) {
    return prisma.notification.findMany({
      where:   { tenantId, isRead: false },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
  }

  async getAll(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where:   { tenantId },
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
      }),
      prisma.notification.count({ where: { tenantId } }),
    ]);
    return { items, total, unread: items.filter((n) => !n.isRead).length };
  }

  async markRead(id: string, tenantId: string) {
    return prisma.notification.updateMany({
      where: { id, tenantId },
      data:  { isRead: true },
    });
  }

  async markAllRead(tenantId: string) {
    return prisma.notification.updateMany({
      where: { tenantId, isRead: false },
      data:  { isRead: true },
    });
  }

  async getUnreadCount(tenantId: string): Promise<number> {
    return prisma.notification.count({ where: { tenantId, isRead: false } });
  }
}

export const inAppService = new InAppNotificationService();
