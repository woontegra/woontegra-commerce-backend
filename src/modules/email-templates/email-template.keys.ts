import type { TemplateKey } from '../email/templates';

/** Panelde yönetilen kiracı şablon anahtarları */
export const EMAIL_TEMPLATE_KEYS = [
  'order_received',
  'payment_success',
  'payment_failed',
  'bank_transfer_pending',
  'order_shipped',
  'order_delivered',
  'order_cancelled',
  'return_request_received',
  'password_reset',
  'contact_form_notification',
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export const EMAIL_TEMPLATE_KEY_LABELS: Record<EmailTemplateKey, string> = {
  order_received:              'Sipariş alındı',
  payment_success:             'Ödeme başarılı',
  payment_failed:                'Ödeme başarısız',
  bank_transfer_pending:         'Havale/EFT bekleniyor',
  order_shipped:                 'Kargoya verildi',
  order_delivered:               'Teslim edildi',
  order_cancelled:               'Sipariş iptal edildi',
  return_request_received:       'İade talebi alındı',
  password_reset:                'Şifre sıfırlama',
  contact_form_notification:     'İletişim formu bildirimi',
};

export const EMAIL_TEMPLATE_VARIABLES = [
  { key: '{{storeName}}',       desc: 'Mağaza adı' },
  { key: '{{customerName}}',    desc: 'Müşteri / gönderen adı' },
  { key: '{{orderNumber}}',     desc: 'Sipariş numarası' },
  { key: '{{orderTotal}}',      desc: 'Sipariş toplamı (para birimi ile)' },
  { key: '{{paymentMethod}}',   desc: 'Ödeme yöntemi' },
  { key: '{{trackingNumber}}',  desc: 'Kargo takip numarası' },
  { key: '{{trackingUrl}}',     desc: 'Kargo takip bağlantısı' },
  { key: '{{resetLink}}',       desc: 'Şifre sıfırlama bağlantısı' },
  { key: '{{contactSubject}}',  desc: 'İletişim formu konusu' },
] as const;

/** Sistem şablonu → kiracı şablon anahtarı */
export function resolveTenantKeyFromSystem(
  template: TemplateKey,
  data: Record<string, unknown>,
): EmailTemplateKey | null {
  switch (template) {
    case 'STORE_ORDER_CREATED':
      return 'order_received';
    case 'STORE_ORDER_PAYMENT_RECEIVED':
    case 'STORE_ORDER_BANK_TRANSFER_APPROVED':
      return 'payment_success';
    case 'STORE_ORDER_PAYMENT_FAILED':
      return 'payment_failed';
    case 'STORE_ORDER_BANK_TRANSFER_PENDING':
      return 'bank_transfer_pending';
    case 'STORE_ORDER_STATUS_UPDATED': {
      const status = String(data.newStatus ?? '').toUpperCase();
      if (status === 'SHIPPED') return 'order_shipped';
      if (status === 'DELIVERED') return 'order_delivered';
      if (status === 'CANCELLED') return 'order_cancelled';
      return null;
    }
    case 'STORE_RETURN_REQUEST_CREATED':
      return 'return_request_received';
    case 'STORE_CUSTOMER_PASSWORD_RESET':
      return 'password_reset';
    default:
      return null;
  }
}

export function isEmailTemplateKey(key: string): key is EmailTemplateKey {
  return (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(key);
}

/** @deprecated use isEmailTemplateKey — sistem şablon anahtarı */
export const isSystemTemplateKey = isEmailTemplateKey;
