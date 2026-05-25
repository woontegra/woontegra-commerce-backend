import { describe, expect, it } from 'vitest';
import {
  buildOrderPaymentBackfillPatch,
  inferPaymentProviderForBackfill,
  inferPaymentProviderFromNotesHeuristics,
  inferPaymentStatusForBackfill,
  normalizePaymentProvider,
  pickPaymentSessionForBackfill,
  type BackfillOrderRow,
} from '../../src/modules/orders/order-payment-backfill.util';

function baseOrder(overrides: Partial<BackfillOrderRow> = {}): BackfillOrderRow {
  return {
    id: 'o1',
    orderNumber: 'ORD-1',
    tenantId: 't1',
    status: 'PENDING',
    notes: null,
    paymentProvider: null,
    paymentStatus: 'PENDING',
    paymentApprovedAt: null,
    paymentFailedAt: null,
    updatedAt: new Date('2026-01-01'),
    paymentSessions: [],
    ...overrides,
  };
}

describe('normalizePaymentProvider / notes parse', () => {
  it('parses PAYTR from notes bracket', () => {
    expect(
      inferPaymentProviderFromNotesHeuristics('[Ödeme yöntemi: PAYTR]\n[Vitrin siparişi]'),
    ).toBe('PAYTR');
  });

  it('parses BANK_TRANSFER from notes and Turkish havale', () => {
    expect(
      inferPaymentProviderFromNotesHeuristics('[Ödeme yöntemi: BANK_TRANSFER]'),
    ).toBe('BANK_TRANSFER');
    expect(
      inferPaymentProviderFromNotesHeuristics('[Havale/EFT — ödeme bekleniyor]'),
    ).toBe('BANK_TRANSFER');
  });

  it('parses CASH_ON_DELIVERY from notes', () => {
    expect(
      inferPaymentProviderFromNotesHeuristics('[Ödeme yöntemi: CASH_ON_DELIVERY]'),
    ).toBe('CASH_ON_DELIVERY');
    expect(
      inferPaymentProviderFromNotesHeuristics('[Kapıda ödeme — sipariş hazırlanıyor]'),
    ).toBe('CASH_ON_DELIVERY');
  });

  it('returns null for ambiguous notes', () => {
    expect(inferPaymentProviderFromNotesHeuristics('Rastgele müşteri notu')).toBeNull();
  });
});

describe('pickPaymentSessionForBackfill', () => {
  it('prefers session provider over notes', () => {
    const order = baseOrder({
      notes: '[Ödeme yöntemi: BANK_TRANSFER]',
      paymentSessions: [
        {
          provider: 'PAYTR',
          status: 'SUCCESS',
          updatedAt: new Date('2026-05-01'),
          createdAt: new Date('2026-05-01'),
        },
      ],
    });
    const { provider, source } = inferPaymentProviderForBackfill(order);
    expect(provider).toBe('PAYTR');
    expect(source).toBe('session');
  });
});

describe('buildOrderPaymentBackfillPatch', () => {
  it('does not overwrite filled paymentProvider', () => {
    const order = baseOrder({
      paymentProvider: 'PAYTR',
      notes: '[Ödeme yöntemi: BANK_TRANSFER]',
    });
    const d = buildOrderPaymentBackfillPatch(order);
    expect(d.willUpdateProvider).toBe(false);
    expect(d.patch.paymentProvider).toBeUndefined();
  });

  it('sets BANK_TRANSFER WAITING_BANK_TRANSFER for PENDING order', () => {
    const order = baseOrder({
      notes: '[Ödeme yöntemi: BANK_TRANSFER]',
      paymentStatus: 'PENDING',
    });
    const d = buildOrderPaymentBackfillPatch(order);
    expect(d.patch.paymentProvider).toBe('BANK_TRANSFER');
    expect(d.patch.paymentStatus).toBe('WAITING_BANK_TRANSFER');
  });

  it('does not guess PAID for BANK_TRANSFER PROCESSING without evidence', () => {
    const order = baseOrder({
      paymentProvider: 'BANK_TRANSFER',
      paymentStatus: 'PENDING',
      status: 'PROCESSING',
      notes: '[Havale/EFT — ödeme bekleniyor]',
    });
    const d = buildOrderPaymentBackfillPatch(order);
    expect(d.patch.paymentStatus).toBeUndefined();
    expect(d.statusSkippedUnsafe).toBe(true);
  });

  it('sets PAID for BANK_TRANSFER when order status is PAID', () => {
    const order = baseOrder({
      paymentProvider: 'BANK_TRANSFER',
      paymentStatus: 'PENDING',
      status: 'PAID',
    });
    const d = buildOrderPaymentBackfillPatch(order);
    expect(d.patch.paymentStatus).toBe('PAID');
  });

  it('keeps CASH_ON_DELIVERY DELIVERED as PENDING not PAID', () => {
    const { status } = inferPaymentStatusForBackfill(
      baseOrder({ status: 'DELIVERED' }),
      'CASH_ON_DELIVERY',
      null,
    );
    expect(status).toBe('PENDING');
    const order = baseOrder({
      notes: '[Ödeme yöntemi: CASH_ON_DELIVERY]',
      status: 'DELIVERED',
      paymentStatus: 'PENDING',
    });
    const d = buildOrderPaymentBackfillPatch(order);
    expect(d.patch.paymentStatus).not.toBe('PAID');
    expect(d.patch.paymentStatus).toBeUndefined();
  });

  it('PAYTR SUCCESS session yields PAID', () => {
    const order = baseOrder({
      paymentSessions: [
        {
          provider: 'PAYTR',
          status: 'SUCCESS',
          updatedAt: new Date('2026-05-10'),
          createdAt: new Date('2026-05-10'),
        },
      ],
      status: 'PAID',
      paymentStatus: 'PENDING',
    });
    const d = buildOrderPaymentBackfillPatch(order);
    expect(d.patch.paymentProvider).toBe('PAYTR');
    expect(d.patch.paymentStatus).toBe('PAID');
  });

  it('does not trigger PAYTR/BANK_TRANSFER template mail fields', () => {
    const order = baseOrder({ notes: '[Ödeme yöntemi: PAYTR]' });
    const d = buildOrderPaymentBackfillPatch(order);
    expect(d.patch).not.toHaveProperty('paymentReceivedEmailSentAt');
    expect(d.patch).not.toHaveProperty('cashOnDeliveryEmailSentAt');
  });

  it('idempotent when provider and locked status already set', () => {
    const order = baseOrder({
      paymentProvider: 'PAYTR',
      paymentStatus: 'PAID',
      status: 'PAID',
    });
    const d = buildOrderPaymentBackfillPatch(order);
    expect(d.willUpdateProvider).toBe(false);
    expect(d.willUpdateStatus).toBe(false);
    expect(Object.keys(d.patch)).toHaveLength(0);
  });
});

describe('normalizePaymentProvider', () => {
  it('maps PayTR label', () => {
    expect(normalizePaymentProvider('PayTR')).toBe('PAYTR');
  });
});
