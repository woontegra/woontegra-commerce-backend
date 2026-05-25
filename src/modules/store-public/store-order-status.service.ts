import prisma from '../../config/database';

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

export type StoreOrderStatusResult = {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    totalAmount: number;
    currency: string;
    createdAt: string;
  };
  payment: {
    provider: string | null;
    status: string | null;
  };
};

export class StoreOrderStatusService {
  /** Vitrin — minimum alan; yalnızca ilgili tenant. */
  async getByOrderNumber(tenantId: string, orderNumber: string): Promise<StoreOrderStatusResult | null> {
    const decoded = decodeURIComponent(orderNumber).trim();
    if (!decoded) return null;

    const order = await prisma.order.findFirst({
      where: { tenantId, orderNumber: decoded },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        currency: true,
        createdAt: true,
      },
    });

    if (!order) return null;

    const session = await prisma.storePaymentSession.findFirst({
      where: { orderId: order.id, tenantId },
      orderBy: { createdAt: 'desc' },
      select: { provider: true, status: true },
    });

    return {
      order: {
        id:          order.id,
        orderNumber: order.orderNumber,
        status:      String(order.status),
        totalAmount: num(order.totalAmount),
        currency:    order.currency,
        createdAt:   order.createdAt.toISOString(),
      },
      payment: session
        ? { provider: session.provider, status: String(session.status) }
        : { provider: null, status: null },
    };
  }
}

export const storeOrderStatusService = new StoreOrderStatusService();
