import {
  parseOrderPaymentProviderFromNotes,
} from '../../orders/order-payment.util';

export type StoreEmailBranding = {
  storeName: string;
  logoUrl:   string | null;
  tenantSlug: string;
};

const FALLBACK_STORE_NAME = 'Woontegra Mağaza';

export function resolveStoreName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed || FALLBACK_STORE_NAME;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMoney(amount: number, currency = 'TRY'): string {
  const symbol = currency === 'TRY' ? '₺' : currency;
  return `${amount.toFixed(2)} ${symbol}`;
}

export function frontendBase(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

/** Vitrin URL — ?tenant=slug ile */
export function storefrontUrl(tenantSlug: string, path: string): string {
  const base = frontendBase();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const qIdx = normalized.indexOf('?');
  const pathname = qIdx >= 0 ? normalized.slice(0, qIdx) : normalized;
  const qs = qIdx >= 0 ? normalized.slice(qIdx + 1) : '';
  const sp = new URLSearchParams(qs);
  sp.set('tenant', tenantSlug);
  return `${base}${pathname}?${sp.toString()}`;
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING:    'Beklemede',
  PROCESSING: 'Hazırlanıyor',
  PAID:       'Ödendi',
  SHIPPED:    'Kargoya Verildi',
  DELIVERED:  'Teslim Edildi',
  CANCELLED:  'İptal Edildi',
  REFUNDED:   'İade Edildi',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  PAYTR:            'Kredi Kartı (PayTR)',
  IYZICO:           'Kredi Kartı (iyzico)',
  BANK_TRANSFER:    'Havale / EFT',
  CASH_ON_DELIVERY: 'Kapıda Ödeme',
};

export const RETURN_TYPE_LABELS: Record<string, string> = {
  CANCEL_REQUEST: 'İptal Talebi',
  RETURN_REQUEST: 'İade Talebi',
};

export const RETURN_STATUS_LABELS: Record<string, string> = {
  PENDING:   'İnceleniyor',
  APPROVED:  'Onaylandı',
  REJECTED:  'Reddedildi',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal Edildi',
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

/** Admin / merkezi updateStatus sonrası müşteriye mail gidecek durumlar (PAID hariç — PayTR ayrı şablon). */
export const CUSTOMER_NOTIFY_ORDER_STATUSES = [
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;

export type CustomerNotifyOrderStatus = (typeof CUSTOMER_NOTIFY_ORDER_STATUSES)[number];

export function shouldNotifyCustomerOrderStatus(oldStatus: string, newStatus: string): boolean {
  if (oldStatus === newStatus) return false;
  return (CUSTOMER_NOTIFY_ORDER_STATUSES as readonly string[]).includes(newStatus);
}

export {
  parseOrderPaymentProviderFromNotes,
  resolveOrderPaymentProvider,
  initialOrderPaymentStatus,
  ORDER_PAYMENT_STATUS_LABELS,
  type OrderPaymentProviderSource,
} from '../../orders/order-payment.util';

/** @deprecated resolveOrderPaymentProvider kullanın — yalnızca notes fallback testleri için */
export function parseOrderPaymentProvider(notes: string | null | undefined): string | null {
  return parseOrderPaymentProviderFromNotes(notes);
}

export type BankTransferApprovalEmailState = {
  bankTransferApprovedEmailSentAt?: Date | null;
  paymentStatus?: string | null;
};

/** Admin BANK_TRANSFER ödeme onayı: PENDING → PAID veya PROCESSING (bir kez). */
export function shouldSendBankTransferPaymentApproved(
  paymentProvider: string | null,
  oldStatus: string,
  newStatus: string,
  emailState?: BankTransferApprovalEmailState,
): boolean {
  if (paymentProvider !== 'BANK_TRANSFER') return false;
  if (oldStatus !== 'PENDING') return false;
  if (oldStatus === newStatus) return false;
  if (emailState?.bankTransferApprovedEmailSentAt) return false;
  const ps = emailState?.paymentStatus;
  if (ps === 'PAID' || ps === 'APPROVED') return false;
  return newStatus === 'PAID' || newStatus === 'PROCESSING';
}

/** Status uygun + çağıran taraf müşteri maili istiyor (ör. admin panel). */
export function shouldSendCustomerStatusEmail(
  notifyCustomer: boolean,
  oldStatus: string,
  newStatus: string,
  paymentProvider?: string | null,
  emailState?: { shippingNotificationSentAt?: Date | null },
): boolean {
  if (!notifyCustomer) return false;
  if (shouldSendBankTransferPaymentApproved(paymentProvider ?? null, oldStatus, newStatus)) {
    return false;
  }
  if (newStatus === 'SHIPPED' && emailState?.shippingNotificationSentAt) {
    return false;
  }
  return shouldNotifyCustomerOrderStatus(oldStatus, newStatus);
}

/**
 * PayTR ödeme başarısız callback — STORE_ORDER_PAYMENT_FAILED yalnızca ilk geçişte.
 * Session zaten FAILED veya sipariş PENDING değilse mail gönderilmez.
 */
export function shouldSendPaytrPaymentFailedNotification(
  sessionStatus: string,
  orderStatus: string,
  emailState?: { paymentFailedEmailSentAt?: Date | null },
): boolean {
  if (sessionStatus === 'SUCCESS') return false;
  if (sessionStatus === 'FAILED') return false;
  if (orderStatus !== 'PENDING') return false;
  if (emailState?.paymentFailedEmailSentAt) return false;
  return true;
}

export function shouldSendPaytrPaymentReceivedNotification(
  emailState?: { paymentReceivedEmailSentAt?: Date | null },
): boolean {
  return !emailState?.paymentReceivedEmailSentAt;
}

export function orderStatusEmailCopy(
  status: string,
  orderNumber: string,
): { subject: string; headline: string; message: string; statusLabel: string } {
  const ref = orderNumber;
  switch (status) {
    case 'PROCESSING':
      return {
        subject:      `Siparişiniz hazırlanıyor - #${ref}`,
        headline:     'Siparişiniz hazırlanıyor',
        message:      'Siparişiniz mağaza tarafından hazırlanmaya başladı.',
        statusLabel:  orderStatusLabel('PROCESSING'),
      };
    case 'SHIPPED':
      return {
        subject:      `Siparişiniz kargoya verildi - #${ref}`,
        headline:     'Siparişiniz kargoya verildi',
        message:      'Siparişiniz kargoya teslim edildi. Aşağıdaki kargo bilgilerinden takip edebilirsiniz.',
        statusLabel:  orderStatusLabel('SHIPPED'),
      };
    case 'DELIVERED':
      return {
        subject:      `Siparişiniz teslim edildi - #${ref}`,
        headline:     'Siparişiniz teslim edildi',
        message:      'Siparişiniz teslim edildi olarak güncellendi.',
        statusLabel:  orderStatusLabel('DELIVERED'),
      };
    case 'CANCELLED':
      return {
        subject:      `Siparişiniz iptal edildi - #${ref}`,
        headline:     'Siparişiniz iptal edildi',
        message:      'Siparişiniz iptal edildi. Detaylar için mağaza ile iletişime geçebilirsiniz.',
        statusLabel:  orderStatusLabel('CANCELLED'),
      };
    default:
      return {
        subject:      `Sipariş durumu güncellendi - #${ref}`,
        headline:     'Sipariş durumu güncellendi',
        message:      'Siparişinizin durumu güncellendi.',
        statusLabel:  orderStatusLabel(status),
      };
  }
}

export function paymentMethodLabel(provider: string | null | undefined): string {
  if (!provider?.trim()) return 'Belirtilmedi';
  return PAYMENT_METHOD_LABELS[provider] ?? provider;
}

export const REFUND_METHOD_LABELS: Record<string, string> = {
  MANUAL_BANK_TRANSFER: 'Banka havalesi',
  CASH:                 'Nakit',
  PAYTR_MANUAL:         'PayTR (manuel)',
  IYZICO_MANUAL:        'iyzico (manuel)',
  OTHER:                'Diğer',
};

export function refundMethodLabel(method: string): string {
  return REFUND_METHOD_LABELS[method] ?? method;
}

export function returnTypeLabel(type: string): string {
  return RETURN_TYPE_LABELS[type] ?? type;
}

export function returnStatusLabel(status: string): string {
  return RETURN_STATUS_LABELS[status] ?? status;
}
