import { describe, expect, it } from 'vitest';
import { parseOrderListQuery } from '../../src/modules/orders/order-list.query';
import { buildOrderListWhere } from '../../src/modules/orders/order-list.util';

describe('parseOrderListQuery', () => {
  it('accepts paymentProvider and paymentStatus', () => {
    const r = parseOrderListQuery({
      paymentProvider: 'PAYTR',
      paymentStatus: 'WAITING_BANK_TRANSFER',
      page: '2',
      limit: '10',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.paymentProvider).toBe('PAYTR');
      expect(r.data.paymentStatus).toBe('WAITING_BANK_TRANSFER');
      expect(r.data.page).toBe(2);
    }
  });

  it('rejects invalid paymentProvider', () => {
    const r = parseOrderListQuery({ paymentProvider: 'INVALID' });
    expect(r.ok).toBe(false);
  });

  it('rejects invalid paymentStatus', () => {
    const r = parseOrderListQuery({ paymentStatus: 'NOT_REAL' });
    expect(r.ok).toBe(false);
  });
});

describe('buildOrderListWhere', () => {
  it('scopes to tenant and applies payment filters', () => {
    const where = buildOrderListWhere('tenant-1', {
      paymentProvider: 'CASH_ON_DELIVERY',
      paymentStatus: 'PENDING',
    });
    expect(where.tenantId).toBe('tenant-1');
    expect(where.paymentProvider).toBe('CASH_ON_DELIVERY');
    expect(where.paymentStatus).toBe('PENDING');
  });

  it('combines status and search with payment filters', () => {
    const where = buildOrderListWhere('t1', {
      status: 'PROCESSING',
      search: 'ORD-',
      paymentProvider: 'BANK_TRANSFER',
    });
    expect(where.status).toBe('PROCESSING');
    expect(where.paymentProvider).toBe('BANK_TRANSFER');
    expect(where.OR).toBeDefined();
  });
});
