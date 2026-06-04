import { formatMoney } from '../email/templates/store-email.util';

export type TemplateVariableContext = Record<string, unknown>;

function str(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Sistem şablon verisinden panel değişkenlerine dönüşüm */
export function buildTemplateVariables(data: TemplateVariableContext): Record<string, string> {
  const storeName = str(data.storeName) || 'Mağazanız';
  const customerName = str(data.customerName) || 'Değerli Müşterimiz';
  const orderNumber = str(data.orderNumber);
  const currency = str(data.currency) || 'TRY';
  const grandTotal = num(data.grandTotal);
  const orderTotal = grandTotal > 0
    ? formatMoney(grandTotal, currency)
    : str(data.orderTotal);

  return {
    storeName,
    customerName,
    orderNumber,
    orderTotal,
    paymentMethod: str(data.paymentMethod),
    trackingNumber: str(data.shippingTrackingNumber ?? data.trackingNumber),
    trackingUrl: str(data.shippingTrackingUrl ?? data.trackingUrl),
    resetLink: str(data.resetUrl ?? data.resetLink),
    contactSubject: str(data.contactSubject ?? data.subject),
  };
}

export function interpolateTemplateString(
  template: string,
  vars: Record<string, string>,
): string {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? '');
}
