import type { OrderPaymentStatus, PaymentProviderType } from '@prisma/client';

/** Sipariş notlarından vitrin ödeme yöntemi (eski kayıtlar — fallback). */
export function parseOrderPaymentProviderFromNotes(notes: string | null | undefined): string | null {
  const match = (notes ?? '').match(/\[Ödeme yöntemi:\s*([^\]]+)\]/i);
  return match?.[1]?.trim() ?? null;
}

export type OrderPaymentProviderSource = {
  paymentProvider?: PaymentProviderType | string | null;
  notes?: string | null;
};

/** Kalıcı alan öncelikli; yoksa notes fallback. */
export function resolveOrderPaymentProvider(order: OrderPaymentProviderSource): string | null {
  if (order.paymentProvider) return String(order.paymentProvider);
  return parseOrderPaymentProviderFromNotes(order.notes);
}

export function initialOrderPaymentStatus(provider: string): OrderPaymentStatus {
  if (provider === 'BANK_TRANSFER') return 'WAITING_BANK_TRANSFER';
  return 'PENDING';
}

export const ORDER_PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING:               'Ödeme bekleniyor',
  WAITING_BANK_TRANSFER:  'Havale/EFT bekleniyor',
  PAID:                  'Ödendi',
  APPROVED:              'Ödeme onaylandı',
  FAILED:                'Ödeme başarısız',
  CANCELLED:             'Ödeme iptal',
};

/** Admin sipariş listesi — kısa ödeme durumu etiketleri */
export const ADMIN_LIST_PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING:               'Bekliyor',
  WAITING_BANK_TRANSFER: 'Havale Bekleniyor',
  PAID:                  'Ödendi',
  APPROVED:              'Onaylandı',
  FAILED:                'Başarısız',
  CANCELLED:             'İptal',
};

export const ADMIN_LIST_PAYMENT_PROVIDER_LABELS: Record<string, string> = {
  PAYTR:            'Kredi Kartı / PayTR',
  IYZICO:           'iyzico',
  BANK_TRANSFER:    'Havale / EFT',
  CASH_ON_DELIVERY: 'Kapıda Ödeme',
  BANK_POS:         'Banka POS',
};

export function adminListPaymentProviderLabel(
  provider: string | null | undefined,
): string {
  if (!provider?.trim()) return 'Belirtilmemiş';
  return ADMIN_LIST_PAYMENT_PROVIDER_LABELS[provider] ?? provider;
}

export function adminListPaymentStatusLabel(
  status: string | null | undefined,
): string {
  if (!status?.trim()) return 'Belirsiz';
  return ADMIN_LIST_PAYMENT_STATUS_LABELS[status] ?? ORDER_PAYMENT_STATUS_LABELS[status] ?? status;
}
