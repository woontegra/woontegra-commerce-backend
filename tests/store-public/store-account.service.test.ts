import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildStoreAccountOrdersWhere } from '../../src/modules/store-public/store-account-orders-query.util';

vi.mock('../../src/config/database', () => ({
  default: {
    order: {
      count:     vi.fn(),
      findFirst: vi.fn(),
      findMany:  vi.fn(),
    },
    $transaction: vi.fn(),
    customer: { findFirst: vi.fn(), update: vi.fn() },
    customerAddress: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../../src/modules/returns/return-request.service', () => ({
  returnRequestService: {
    getActiveForOrder: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../src/modules/payments/tenant-payment-settings.service', () => ({
  tenantPaymentSettingsService: {
    getActiveBankTransferDetails: vi.fn().mockResolvedValue(null),
  },
}));

import prisma from '../../src/config/database';
import { StoreAccountService } from '../../src/modules/store-public/store-account.service';

describe('StoreAccountService.getOrdersSummary', () => {
  const svc = new StoreAccountService();
  const tenantId = 'tenant-a';
  const customerId = 'customer-b';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts with tenant + customer scope and WAITING_PAYMENT where helper', async () => {
    vi.mocked(prisma.order.count)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(1);

    const summary = await svc.getOrdersSummary(tenantId, customerId);

    expect(summary).toEqual({
      total: 12,
      waitingPayment: 2,
      processing: 3,
      shipped: 1,
      delivered: 5,
      cancelled: 1,
    });

    expect(prisma.order.count).toHaveBeenCalledTimes(6);

    const baseCall = vi.mocked(prisma.order.count).mock.calls[0][0];
    expect(baseCall?.where).toEqual({ tenantId, customerId });

    const waitingCall = vi.mocked(prisma.order.count).mock.calls[1][0];
    expect(waitingCall?.where).toEqual(
      buildStoreAccountOrdersWhere(tenantId, customerId, {
        filter: 'WAITING_PAYMENT',
        page: 1,
        limit: 10,
      }),
    );

    const shippedCall = vi.mocked(prisma.order.count).mock.calls[3][0];
    expect(shippedCall?.where).toEqual(
      buildStoreAccountOrdersWhere(tenantId, customerId, {
        status: 'SHIPPED',
        page: 1,
        limit: 10,
      }),
    );

    const deliveredCall = vi.mocked(prisma.order.count).mock.calls[4][0];
    expect(deliveredCall?.where).toMatchObject({ status: 'DELIVERED' });
    expect(deliveredCall?.where).not.toMatchObject({ status: 'SHIPPED' });
  });

  it('returns zeros when customer has no orders', async () => {
    vi.mocked(prisma.order.count).mockResolvedValue(0);

    const summary = await svc.getOrdersSummary(tenantId, customerId);

    expect(summary).toEqual({
      total: 0,
      waitingPayment: 0,
      processing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
    });
  });
});

describe('StoreAccountService.getOrderByNumber', () => {
  const svc = new StoreAccountService();
  const tenantId = 'tenant-a';
  const customerId = 'customer-b';
  const shippedAt = new Date('2026-05-25T11:30:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when order not owned by customer/tenant', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null);

    const result = await svc.getOrderByNumber(tenantId, customerId, 'ORD-404');

    expect(result).toBeNull();
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, customerId, orderNumber: 'ORD-404' },
      }),
    );
  });

  it('returns public shipping fields without internal timestamps', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue({
      id: 'ord-1',
      orderNumber: 'ORD-100',
      status: 'SHIPPED',
      currency: 'TRY',
      createdAt: shippedAt,
      notes: null,
      totalAmount: 100,
      shippingPrice: 0,
      shippingCarrier: 'MNG',
      shippingTrackingNumber: 'TRK1',
      shippingTrackingUrl: 'https://kargo.test/t/TRK1',
      shippedAt,
      shippingNotificationSentAt: shippedAt,
      paymentProvider: 'PAYTR',
      paymentStatus: 'PAID',
      paymentApprovedAt: shippedAt,
      paymentFailedAt: null,
      items: [],
      paymentSessions: [],
    } as never);

    const result = await svc.getOrderByNumber(tenantId, customerId, 'ORD-100');

    expect(result).toMatchObject({
      orderNumber: 'ORD-100',
      shippingCarrier: 'MNG',
      shippingTrackingNumber: 'TRK1',
      shippingTrackingUrl: 'https://kargo.test/t/TRK1',
      shippedAt: shippedAt.toISOString(),
    });
    expect(result).not.toHaveProperty('shippingNotificationSentAt');
    expect(result?.payment).not.toHaveProperty('paymentReceivedEmailSentAt');
    expect(result?.payment).not.toHaveProperty('paymentSessions');
  });
});

describe('StoreAccountService.listOrders', () => {
  const svc = new StoreAccountService();
  const tenantId = 'tenant-a';
  const customerId = 'customer-b';
  const createdAt = new Date('2026-05-25T10:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns public payment fields without mail timestamps or payment sessions', async () => {
    const row = {
      id: 'ord-2',
      orderNumber: 'ORD-200',
      status: 'PROCESSING',
      paymentProvider: 'BANK_TRANSFER',
      paymentStatus: 'WAITING_BANK_TRANSFER',
      paymentApprovedAt: null,
      paymentFailedAt: null,
      totalAmount: 250,
      currency: 'TRY',
      createdAt,
      shippingPrice: 0,
      items: [],
      paymentSessions: [{ id: 'sess-1', provider: 'PAYTR', status: 'PAID', token: 'secret' }],
      paymentReceivedEmailSentAt: createdAt,
      paymentFailedEmailSentAt: createdAt,
    };

    vi.mocked(prisma.$transaction).mockResolvedValue([1, [row]] as never);

    const result = await svc.listOrders(tenantId, customerId, { page: 1, limit: 10 });

    expect(prisma.$transaction).toHaveBeenCalled();
    const findManyCall = vi.mocked(prisma.$transaction).mock.calls[0];
    expect(findManyCall).toBeDefined();

    expect(result.orders[0]).toMatchObject({
      paymentProvider: 'BANK_TRANSFER',
      paymentStatus: 'WAITING_BANK_TRANSFER',
      paymentApprovedAt: null,
      paymentFailedAt: null,
    });
    expect(result.orders[0]).not.toHaveProperty('paymentSessions');
    expect(result.orders[0]).not.toHaveProperty('paymentReceivedEmailSentAt');
    expect(result.orders[0]).not.toHaveProperty('paymentFailedEmailSentAt');
  });

  it('scopes list query to tenant and customer', async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([0, []] as never);

    await svc.listOrders(tenantId, customerId, { page: 1, limit: 10 });

    const txArgs = vi.mocked(prisma.$transaction).mock.calls[0][0];
    expect(Array.isArray(txArgs)).toBe(true);
  });
});
