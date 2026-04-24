import { PrismaClient, NotificationType } from '@prisma/client';

const prisma = new PrismaClient();

export class NotificationService {
  /**
   * Create a new notification
   */
  static async create(
    tenantId: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: any
  ) {
    try {
      const notification = await prisma.notification.create({
        data: {
          tenantId,
          type,
          title,
          message,
          data: data || null,
        },
      });

      return notification;
    } catch (error) {
      console.error('Failed to create notification:', error);
      return null;
    }
  }

  /**
   * Notify when new order is created
   */
  static async notifyOrderCreated(tenantId: string, orderId: string, customerName: string, total: number) {
    return this.create(
      tenantId,
      'ORDER_CREATED',
      'Yeni Sipariş',
      `${customerName} tarafından $${total.toFixed(2)} tutarında yeni sipariş oluşturuldu`,
      { orderId, customerName, total }
    );
  }

  /**
   * Notify when stock is low
   */
  static async notifyStockLow(tenantId: string, productId: string, productName: string, stock: number) {
    return this.create(
      tenantId,
      'STOCK_LOW',
      'Stok Azaldı',
      `${productName} ürününün stoğu ${stock} adete düştü`,
      { productId, productName, stock }
    );
  }

  /**
   * Notify when stock is out
   */
  static async notifyStockOut(tenantId: string, productId: string, productName: string) {
    return this.create(
      tenantId,
      'STOCK_OUT',
      'Stok Bitti',
      `${productName} ürününün stoğu tükendi`,
      { productId, productName }
    );
  }

  /**
   * Send system message
   */
  static async sendSystemMessage(tenantId: string, title: string, message: string) {
    return this.create(
      tenantId,
      'SYSTEM_MESSAGE',
      title,
      message
    );
  }

  /**
   * Notify when payment is received
   */
  static async notifyPaymentReceived(tenantId: string, orderId: string, amount: number) {
    return this.create(
      tenantId,
      'PAYMENT_RECEIVED',
      'Ödeme Alındı',
      `$${amount.toFixed(2)} tutarında ödeme alındı`,
      { orderId, amount }
    );
  }

  /**
   * Get unread notification count
   */
  static async getUnreadCount(tenantId: string): Promise<number> {
    try {
      return await prisma.notification.count({
        where: {
          tenantId,
          isRead: false,
        },
      });
    } catch (error) {
      console.error('Failed to get unread count:', error);
      return 0;
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId: string, tenantId: string) {
    try {
      await prisma.notification.update({
        where: {
          id: notificationId,
          tenantId,
        },
        data: {
          isRead: true,
        },
      });
      return true;
    } catch (error) {
      console.error('Failed to mark as read:', error);
      return false;
    }
  }

  /**
   * Mark all notifications as read
   */
  static async markAllAsRead(tenantId: string) {
    try {
      await prisma.notification.updateMany({
        where: {
          tenantId,
          isRead: false,
        },
        data: {
          isRead: true,
        },
      });
      return true;
    } catch (error) {
      console.error('Failed to mark all as read:', error);
      return false;
    }
  }

  /**
   * Delete notification
   */
  static async delete(notificationId: string, tenantId: string) {
    try {
      await prisma.notification.delete({
        where: {
          id: notificationId,
          tenantId,
        },
      });
      return true;
    } catch (error) {
      console.error('Failed to delete notification:', error);
      return false;
    }
  }
}
