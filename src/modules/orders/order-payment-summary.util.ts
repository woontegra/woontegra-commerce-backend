import type { OrderPaymentStatus, PaymentProviderType } from '@prisma/client';
import { PAYMENT_PROVIDER_TYPES } from '../payments/payment-provider.types';

export const PAYMENT_SUMMARY_PROVIDERS = [
  ...PAYMENT_PROVIDER_TYPES,
  'UNKNOWN',
] as const;

export const PAYMENT_SUMMARY_STATUSES = [
  'PENDING',
  'WAITING_BANK_TRANSFER',
  'PAID',
  'APPROVED',
  'FAILED',
  'CANCELLED',
  'UNKNOWN',
] as const;

export type PaymentSummaryProviderKey = typeof PAYMENT_SUMMARY_PROVIDERS[number];
export type PaymentSummaryStatusKey = typeof PAYMENT_SUMMARY_STATUSES[number];

export type PaymentSummary = {
  byProvider: Record<PaymentSummaryProviderKey, number>;
  byStatus: Record<PaymentSummaryStatusKey, number>;
};

export function emptyPaymentSummary(): PaymentSummary {
  return {
    byProvider: {
      PAYTR:            0,
      IYZICO:           0,
      BANK_POS:         0,
      BANK_TRANSFER:    0,
      CASH_ON_DELIVERY: 0,
      UNKNOWN:          0,
    },
    byStatus: {
      PENDING:               0,
      WAITING_BANK_TRANSFER: 0,
      PAID:                  0,
      APPROVED:              0,
      FAILED:                0,
      CANCELLED:             0,
      UNKNOWN:               0,
    },
  };
}

const KNOWN_PROVIDERS = new Set<string>(PAYMENT_PROVIDER_TYPES);

export function mapProviderGroupKey(
  value: PaymentProviderType | null,
): PaymentSummaryProviderKey {
  if (value == null) return 'UNKNOWN';
  return KNOWN_PROVIDERS.has(value) ? (value as PaymentSummaryProviderKey) : 'UNKNOWN';
}

export function mapStatusGroupKey(
  value: OrderPaymentStatus | null,
): PaymentSummaryStatusKey {
  if (value == null) return 'UNKNOWN';
  if ((PAYMENT_SUMMARY_STATUSES as readonly string[]).includes(value)) {
    return value as PaymentSummaryStatusKey;
  }
  return 'UNKNOWN';
}

export function mergePaymentSummaryGroups(
  providerRows: Array<{ paymentProvider: PaymentProviderType | null; _count: { _all: number } }>,
  statusRows: Array<{ paymentStatus: OrderPaymentStatus | null; _count: { _all: number } }>,
): PaymentSummary {
  const summary = emptyPaymentSummary();

  for (const row of providerRows) {
    const key = mapProviderGroupKey(row.paymentProvider);
    summary.byProvider[key] += row._count._all;
  }

  for (const row of statusRows) {
    const key = mapStatusGroupKey(row.paymentStatus);
    summary.byStatus[key] += row._count._all;
  }

  return summary;
}

/** Dashboard `days` parametresi ile uyumlu — son N takvim günü (UTC). */
export function orderSummarySinceDate(days: number): Date {
  const d = Math.min(Math.max(days, 1), 90);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (d - 1));
  return since;
}
