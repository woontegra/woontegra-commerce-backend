import { sendOrderReceivedMail, sendOrderShippedMail } from './order-mail.handler';
import { NotificationService } from '../../services/notification.service';
import { triggerWebhook } from '../webhooks/webhook.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Trigger when order is created
 */
export async function onOrderCreated(orderId: string): Promise<void> {
  // Send order received email
  await sendOrderReceivedMail(orderId);

  // Create notification
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (order) {
      const customerName = `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim();
      await NotificationService.notifyOrderCreated(
        order.tenantId,
        orderId,
        customerName || 'Müşteri',
        Number(order.total)
      );

      // Trigger webhook
      await triggerWebhook(order.tenantId, 'order.created', {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: Number(order.total),
        customerName,
        createdAt: order.createdAt,
      });
    }
  } catch (error) {
    console.error('Failed to create order notification:', error);
  }
}

/**
 * Trigger when order status changes to SHIPPED
 */
export async function onOrderShipped(
  orderId: string,
  trackingNumber: string,
  shippingCompany?: string
): Promise<void> {
  // Send order shipped email
  await sendOrderShippedMail(orderId, trackingNumber, shippingCompany);
}

/**
 * Trigger when order status changes
 */
export async function onOrderStatusChanged(
  orderId: string,
  newStatus: string,
  metadata?: {
    trackingNumber?: string;
    shippingCompany?: string;
  }
): Promise<void> {
  if (newStatus === 'SHIPPED' && metadata?.trackingNumber) {
    await onOrderShipped(orderId, metadata.trackingNumber, metadata.shippingCompany);
  }
}
