import { describe, expect, it } from 'vitest';
import {
  emptyPaymentSummary,
  mapProviderGroupKey,
  mapStatusGroupKey,
  mergePaymentSummaryGroups,
  orderSummarySinceDate,
} from '../../src/modules/orders/order-payment-summary.util';

describe('order-payment-summary.util', () => {
  it('maps null provider and status to UNKNOWN', () => {
    expect(mapProviderGroupKey(null)).toBe('UNKNOWN');
    expect(mapStatusGroupKey(null)).toBe('UNKNOWN');
  });

  it('merges groupBy rows into full summary buckets', () => {
    const summary = mergePaymentSummaryGroups(
      [
        { paymentProvider: 'PAYTR', _count: { _all: 3 } },
        { paymentProvider: null, _count: { _all: 2 } },
        { paymentProvider: 'BANK_TRANSFER', _count: { _all: 1 } },
      ],
      [
        { paymentStatus: 'PAID', _count: { _all: 2 } },
        { paymentStatus: 'WAITING_BANK_TRANSFER', _count: { _all: 1 } },
        { paymentStatus: null, _count: { _all: 1 } },
      ],
    );

    expect(summary.byProvider.PAYTR).toBe(3);
    expect(summary.byProvider.UNKNOWN).toBe(2);
    expect(summary.byProvider.BANK_TRANSFER).toBe(1);
    expect(summary.byProvider.CASH_ON_DELIVERY).toBe(0);
    expect(summary.byStatus.PAID).toBe(2);
    expect(summary.byStatus.WAITING_BANK_TRANSFER).toBe(1);
    expect(summary.byStatus.UNKNOWN).toBe(1);
  });

  it('emptyPaymentSummary has zero counts for all keys', () => {
    const s = emptyPaymentSummary();
    expect(Object.values(s.byProvider).reduce((a, b) => a + b, 0)).toBe(0);
    expect(Object.values(s.byStatus).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('orderSummarySinceDate covers last N calendar days', () => {
    const since7 = orderSummarySinceDate(7);
    const since30 = orderSummarySinceDate(30);
    expect(since30.getTime()).toBeLessThan(since7.getTime());
  });
});
