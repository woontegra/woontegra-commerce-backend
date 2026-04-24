import { PrismaClient } from '@prisma/client';
import { mailService, OrderReceivedData, OrderShippedData } from '../../services/mail.service';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

/**
 * Send order received email when order is created
 */
export async function sendOrderReceivedMail(orderId: string): Promise<void> {
  try {
    // Fetch order with all details
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        items: {
          include: {
            product: {
              select: { name: true },
            },
          },
        },
        tenant: {
          select: {
            name: true,
            settings: {
              select: {
                contactEmail: true,
              },
            },
          },
        },
      },
    });

    if (!order || !order.customer) {
      logger.warn('[OrderMail] Order or customer not found', { orderId });
      return;
    }

    // Prepare email data
    const emailData: OrderReceivedData = {
      customerName: `${order.customer.firstName} ${order.customer.lastName}`,
      orderNumber: order.orderNumber || order.id.substring(0, 8).toUpperCase(),
      orderDate: new Date(order.createdAt).toLocaleDateString('tr-TR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      orderStatus: getOrderStatusLabel(order.status),
      items: order.items.map(item => ({
        name: item.product?.name || 'Ürün',
        quantity: item.quantity,
        price: item.price.toLocaleString('tr-TR'),
        total: (item.price * item.quantity).toLocaleString('tr-TR'),
      })),
      orderTotal: order.total.toLocaleString('tr-TR'),
      shippingAddress: {
        fullName: order.shippingAddress?.fullName || `${order.customer.firstName} ${order.customer.lastName}`,
        address: order.shippingAddress?.address || order.customer.address || '',
        city: order.shippingAddress?.city || order.customer.city || '',
        postalCode: order.shippingAddress?.postalCode || '',
        phone: order.shippingAddress?.phone || order.customer.phone || '',
      },
      orderUrl: `${process.env.FRONTEND_URL}/orders/${order.id}`,
      supportEmail: order.tenant.settings?.contactEmail || 'destek@woontegra.com',
      storeName: order.tenant.name,
    };

    // Send email
    await mailService.sendOrderReceivedEmail(order.customer.email, emailData);

    logger.info('[OrderMail] Order received email sent', {
      orderId,
      customerEmail: order.customer.email,
    });
  } catch (error) {
    logger.error('[OrderMail] Failed to send order received email', {
      orderId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Send order shipped email when order status changes to SHIPPED
 */
export async function sendOrderShippedMail(
  orderId: string,
  trackingNumber: string,
  shippingCompany: string = 'Kargo Şirketi'
): Promise<void> {
  try {
    // Fetch order with all details
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        tenant: {
          select: {
            name: true,
            settings: {
              select: {
                contactEmail: true,
              },
            },
          },
        },
      },
    });

    if (!order || !order.customer) {
      logger.warn('[OrderMail] Order or customer not found', { orderId });
      return;
    }

    // Calculate estimated delivery (3-5 business days)
    const estimatedDate = new Date();
    estimatedDate.setDate(estimatedDate.getDate() + 4);

    // Prepare email data
    const emailData: OrderShippedData = {
      customerName: `${order.customer.firstName} ${order.customer.lastName}`,
      orderNumber: order.orderNumber || order.id.substring(0, 8).toUpperCase(),
      trackingNumber,
      shippingCompany,
      shippingDate: new Date().toLocaleDateString('tr-TR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      estimatedDelivery: estimatedDate.toLocaleDateString('tr-TR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      shippingAddress: {
        fullName: order.shippingAddress?.fullName || `${order.customer.firstName} ${order.customer.lastName}`,
        address: order.shippingAddress?.address || order.customer.address || '',
        city: order.shippingAddress?.city || order.customer.city || '',
        postalCode: order.shippingAddress?.postalCode || '',
        phone: order.shippingAddress?.phone || order.customer.phone || '',
      },
      trackingUrl: `https://kargotakip.com/${trackingNumber}`, // Generic tracking URL
      orderUrl: `${process.env.FRONTEND_URL}/orders/${order.id}`,
      supportEmail: order.tenant.settings?.contactEmail || 'destek@woontegra.com',
      storeName: order.tenant.name,
    };

    // Send email
    await mailService.sendOrderShippedEmail(order.customer.email, emailData);

    logger.info('[OrderMail] Order shipped email sent', {
      orderId,
      customerEmail: order.customer.email,
      trackingNumber,
    });
  } catch (error) {
    logger.error('[OrderMail] Failed to send order shipped email', {
      orderId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get order status label in Turkish
 */
function getOrderStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: 'Beklemede',
    PROCESSING: 'İşleniyor',
    PAID: 'Ödendi',
    SHIPPED: 'Kargoya Verildi',
    DELIVERED: 'Teslim Edildi',
    CANCELLED: 'İptal Edildi',
    REFUNDED: 'İade Edildi',
  };
  return labels[status] || status;
}
