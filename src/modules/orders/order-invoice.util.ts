import { sanitizeShippingTrackingUrl } from './order-shipping.util';

const INVOICE_NUMBER_MAX = 64;

export type OrderInvoiceInput = {
  invoiceNumber?: string | null;
  invoiceUrl?:    string | null;
};

export function normalizeInvoiceNumber(value: string | null | undefined): string | null {
  if (value === undefined) return null;
  return value?.trim().slice(0, INVOICE_NUMBER_MAX) || null;
}

export function normalizeInvoiceUrl(value: string | null | undefined): string | null {
  if (value === undefined) return null;
  return value?.trim() ? sanitizeShippingTrackingUrl(value) : null;
}
