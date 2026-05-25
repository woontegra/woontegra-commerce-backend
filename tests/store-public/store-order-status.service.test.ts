import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database', () => ({
  default: {
    order: { findFirst: vi.fn() },
    storePaymentSession: { findFirst: vi.fn() },
  },
}));

import prisma from '../../src/config/database';
import { StoreOrderStatusService } from '../../src/modules/store-public/store-order-status.service';

describe('StoreOrderStatusService', () => {
  const svc = new StoreOrderStatusService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when order not in tenant', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null);
    const r = await svc.getByOrderNumber('tenant-1', 'ORD-999');
    expect(r).toBeNull();
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1', orderNumber: 'ORD-999' },
      }),
    );
  });

  it('returns order and payment session', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue({
      id: 'o1',
      orderNumber: 'ORD-1',
      status: 'PAID',
      totalAmount: 100,
      currency: 'TRY',
      createdAt: new Date('2026-01-01'),
    } as never);
    vi.mocked(prisma.storePaymentSession.findFirst).mockResolvedValue({
      provider: 'PAYTR',
      status: 'SUCCESS',
    } as never);

    const r = await svc.getByOrderNumber('tenant-1', 'ORD-1');
    expect(r?.order.status).toBe('PAID');
    expect(r?.payment).toEqual({ provider: 'PAYTR', status: 'SUCCESS' });
  });

  it('returns null payment when no session', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue({
      id: 'o1',
      orderNumber: 'ORD-2',
      status: 'PENDING',
      totalAmount: 50,
      currency: 'TRY',
      createdAt: new Date(),
    } as never);
    vi.mocked(prisma.storePaymentSession.findFirst).mockResolvedValue(null);

    const r = await svc.getByOrderNumber('tenant-1', 'ORD-2');
    expect(r?.payment).toEqual({ provider: null, status: null });
  });
});
