import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/database', () => ({
  default: {
    order: { findFirst: vi.fn() },
    orderReturnRequest: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../../src/modules/store-public/store-email.service', () => ({
  storeEmailService: { notifyReturnRequestCreated: vi.fn() },
}));

vi.mock('../../src/modules/orders/order.service', () => ({
  OrderService: vi.fn(),
}));

import prisma from '../../src/config/database';
import { ReturnRequestService } from '../../src/modules/returns/return-request.service';

describe('ReturnRequestService.createForCustomer', () => {
  const svc = new ReturnRequestService();
  const tenantId = 'tenant-a';
  const customerId = 'customer-b';
  const orderId = 'order-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockOrder(status: string, items: Array<{ id: string; quantity: number }> = [{ id: 'item-1', quantity: 2 }]) {
    vi.mocked(prisma.order.findFirst).mockResolvedValue({
      id: orderId,
      orderNumber: 'ORD-1',
      status,
      items,
    } as never);
    vi.mocked(prisma.orderReturnRequest.findFirst).mockResolvedValue(null);
  }

  it('creates cancel request for PROCESSING order', async () => {
    mockOrder('PROCESSING');
    vi.mocked(prisma.orderReturnRequest.create).mockResolvedValue({
      id: 'req-1',
      requestNumber: 'RTN-1',
      tenantId,
      orderId,
      customerId,
      type: 'CANCEL_REQUEST',
      status: 'PENDING',
      reason: 'Vazgeçtim',
      customerNote: null,
      adminNote: 'secret',
      stockRestoredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
      order: { id: orderId, orderNumber: 'ORD-1', status: 'PROCESSING' },
    } as never);

    const result = await svc.createForCustomer(tenantId, customerId, 'ORD-1', {
      type: 'CANCEL_REQUEST',
      reason: 'Vazgeçtim',
    });

    expect(result.type).toBe('CANCEL_REQUEST');
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, customerId, orderNumber: 'ORD-1' },
      }),
    );
  });

  it('rejects return request for SHIPPED order', async () => {
    mockOrder('SHIPPED');
    await expect(
      svc.createForCustomer(tenantId, customerId, 'ORD-1', {
        type: 'RETURN_REQUEST',
        reason: 'İade istiyorum',
        items: [{ orderItemId: 'item-1', quantity: 1 }],
      }),
    ).rejects.toThrow(/teslimat sonrası/i);
  });

  it('creates return request for DELIVERED order', async () => {
    mockOrder('DELIVERED');
    vi.mocked(prisma.orderReturnRequest.create).mockResolvedValue({
      id: 'req-2',
      requestNumber: 'RTN-2',
      tenantId,
      orderId,
      customerId,
      type: 'RETURN_REQUEST',
      status: 'PENDING',
      reason: 'Hasarlı ürün',
      customerNote: null,
      adminNote: null,
      stockRestoredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
      order: { id: orderId, orderNumber: 'ORD-1', status: 'DELIVERED' },
    } as never);

    const result = await svc.createForCustomer(tenantId, customerId, 'ORD-1', {
      type: 'RETURN_REQUEST',
      reason: 'Hasarlı ürün',
      items: [{ orderItemId: 'item-1', quantity: 1 }],
    });

    expect(result.type).toBe('RETURN_REQUEST');
  });

  it('rejects when order not found for customer', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null);
    await expect(
      svc.createForCustomer(tenantId, 'other-customer', 'ORD-1', {
        type: 'CANCEL_REQUEST',
        reason: 'Test',
      }),
    ).rejects.toThrow(/bulunamadı/i);
  });

  it('rejects second active request', async () => {
    mockOrder('PROCESSING');
    vi.mocked(prisma.orderReturnRequest.findFirst).mockResolvedValue({
      id: 'existing',
      status: 'PENDING',
    } as never);

    await expect(
      svc.createForCustomer(tenantId, customerId, 'ORD-1', {
        type: 'CANCEL_REQUEST',
        reason: 'Tekrar',
      }),
    ).rejects.toThrow(/zaten bekleyen/i);
  });

  it('rejects quantity above order item', async () => {
    mockOrder('DELIVERED', [{ id: 'item-1', quantity: 1 }]);
    await expect(
      svc.createForCustomer(tenantId, customerId, 'ORD-1', {
        type: 'RETURN_REQUEST',
        reason: 'Fazla adet',
        items: [{ orderItemId: 'item-1', quantity: 5 }],
      }),
    ).rejects.toThrow(/Geçersiz adet/i);
  });

  it('rejects cancel for CANCELLED order', async () => {
    mockOrder('CANCELLED');
    await expect(
      svc.createForCustomer(tenantId, customerId, 'ORD-1', {
        type: 'CANCEL_REQUEST',
        reason: 'İptal',
      }),
    ).rejects.toThrow(/zaten iptal/i);
  });
});

describe('ReturnRequestService.listByCustomer', () => {
  const svc = new ReturnRequestService();
  const tenantId = 'tenant-a';
  const customerId = 'customer-b';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes list to tenant and customer', async () => {
    vi.mocked(prisma.orderReturnRequest.findMany).mockResolvedValue([]);

    await svc.listByCustomer(tenantId, customerId);

    expect(prisma.orderReturnRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, customerId },
      }),
    );
  });
});
