import type { OrderPaymentStatus, PaymentProviderType } from '@prisma/client';
import {
  adminListPaymentProviderLabel,
  adminListPaymentStatusLabel,
  resolveOrderPaymentProvider,
} from '../orders/order-payment.util';

/** Müşteri hesabı API — güvenli kargo alanları (internal alanlar hariç). */
export type CustomerOrderShippingPublic = {
  shippingCarrier:        string | null;
  shippingTrackingNumber: string | null;
  shippingTrackingUrl:    string | null;
  shippedAt:              string | null;
};

type OrderShippingRow = {
  shippingCarrier?:        string | null;
  shippingTrackingNumber?: string | null;
  shippingTrackingUrl?:    string | null;
  shippedAt?:              Date | null;
  shippingNotificationSentAt?: Date | null;
};

export function pickCustomerShippingFields(order: OrderShippingRow): CustomerOrderShippingPublic {
  return {
    shippingCarrier:        order.shippingCarrier ?? null,
    shippingTrackingNumber: order.shippingTrackingNumber ?? null,
    shippingTrackingUrl:    order.shippingTrackingUrl ?? null,
    shippedAt:              order.shippedAt ? order.shippedAt.toISOString() : null,
  };
}

export type CustomerOrderPaymentPublic = {
  provider:       string | null;
  providerLabel:  string;
  status:         string | null;
  statusLabel:    string;
  approvedAt:     string | null;
  failedAt:       string | null;
  hint:           string;
  methodLabel:    string;
};

type OrderPaymentRow = {
  paymentProvider?:      PaymentProviderType | null;
  paymentStatus?:        OrderPaymentStatus | null;
  paymentApprovedAt?:    Date | null;
  paymentFailedAt?:      Date | null;
  notes?:                string | null;
  paymentReceivedEmailSentAt?:       Date | null;
  paymentFailedEmailSentAt?:         Date | null;
  bankTransferPendingEmailSentAt?:   Date | null;
  bankTransferApprovedEmailSentAt?:  Date | null;
  cashOnDeliveryEmailSentAt?:        Date | null;
};

/** Müşteriye yönelik kısa ödeme açıklaması. */
export function buildCustomerPaymentHint(
  provider: string | null,
  status: string | null,
): string {
  if (!provider) return 'Ödeme yöntemi bilgisi bulunamadı.';
  if (!status) return 'Ödeme durumu bilgisi bulunamadı.';

  if (provider === 'PAYTR' && status === 'PAID') {
    return 'Ödemeniz başarıyla alınmıştır.';
  }
  if (provider === 'PAYTR' && status === 'FAILED') {
    return 'Ödeme işlemi tamamlanamadı.';
  }
  if (provider === 'BANK_TRANSFER' && status === 'WAITING_BANK_TRANSFER') {
    return 'Havale/EFT ödemeniz bekleniyor. Ödeme açıklamasına sipariş numaranızı yazmanız önerilir.';
  }
  if (provider === 'BANK_TRANSFER' && (status === 'PAID' || status === 'APPROVED')) {
    return 'Havale/EFT ödemeniz mağaza tarafından onaylanmıştır.';
  }
  if (provider === 'CASH_ON_DELIVERY') {
    return 'Ödemenizi teslimat sırasında yapabilirsiniz.';
  }
  return '';
}

/** Müşteri sipariş detay/liste — güvenli ödeme alanları (session/credential/mail timestamp yok). */
export type CustomerBankTransferPaymentPublic = {
  bankName:           string | null;
  accountHolder:      string | null;
  iban:               string | null;
  description:        string | null;
  paymentReference:   string;
};

type OrderBankTransferEligibilityRow = OrderPaymentRow & {
  status?: string;
};

/** Müşteri detayda Havale/EFT banka bilgisi gösterilir mi? */
export function shouldShowCustomerBankTransferPayment(
  order: OrderBankTransferEligibilityRow,
): boolean {
  const provider = resolveOrderPaymentProvider(order);
  if (provider !== 'BANK_TRANSFER') return false;

  const orderStatus = order.status ?? '';
  if (orderStatus === 'CANCELLED' || orderStatus === 'DELIVERED') return false;

  const ps = order.paymentStatus ? String(order.paymentStatus) : null;
  if (ps === 'PAID' || ps === 'APPROVED' || ps === 'CANCELLED') return false;
  if (ps === 'WAITING_BANK_TRANSFER' || ps === 'PENDING') return true;

  if (!ps && (orderStatus === 'PENDING' || orderStatus === 'PROCESSING')) return true;

  return false;
}

export function buildCustomerBankTransferPayment(
  orderNumber: string,
  details: {
    bankName:      string;
    accountHolder: string;
    iban:          string;
    description:   string;
  } | null,
): CustomerBankTransferPaymentPublic | null {
  if (!details?.iban?.trim() || !details.bankName?.trim()) return null;
  return {
    bankName:         details.bankName,
    accountHolder:    details.accountHolder || null,
    iban:             details.iban,
    description:      details.description?.trim() || null,
    paymentReference: orderNumber,
  };
}

/** Müşteri API — güvenli iade/iptal talebi (admin notu / stok / internal id yok). */
export type CustomerReturnRequestPublic = {
  id:            string;
  requestNumber: string;
  type:          string;
  status:        string;
  reason:        string;
  customerNote:  string | null;
  createdAt:     string;
  updatedAt:     string;
  order?: {
    id:          string;
    orderNumber: string;
    status:      string;
    totalAmount?: number | null;
    currency?:    string | null;
  };
  items: Array<{
    id:          string;
    orderItemId: string;
    quantity:    number;
    reason:      string | null;
    productName?: string;
    variantName?: string | null;
  }>;
};

type ReturnRequestMapped = {
  id:            string;
  requestNumber: string;
  type:          string;
  status:        string;
  reason:        string;
  customerNote:  string | null;
  createdAt:     Date | string;
  updatedAt:     Date | string;
  order?: {
    id:          string;
    orderNumber: string;
    status:      string;
    totalAmount?: number | null;
    currency?:    string | null;
  };
  items?: Array<{
    id:          string;
    orderItemId: string;
    quantity:    number;
    reason:      string | null;
    productName?: string;
    variantName?: string | null;
  }>;
};

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : d;
}

export function pickCustomerReturnRequestPublic(
  row: ReturnRequestMapped | null,
): CustomerReturnRequestPublic | null {
  if (!row) return null;
  return {
    id:            row.id,
    requestNumber: row.requestNumber,
    type:          row.type,
    status:        row.status,
    reason:        row.reason,
    customerNote:  row.customerNote,
    createdAt:     toIso(row.createdAt),
    updatedAt:     toIso(row.updatedAt),
    order: row.order
      ? {
          id:          row.order.id,
          orderNumber: row.order.orderNumber,
          status:      row.order.status,
          totalAmount: row.order.totalAmount ?? null,
          currency:    row.order.currency ?? null,
        }
      : undefined,
    items: (row.items ?? []).map(i => ({
      id:          i.id,
      orderItemId: i.orderItemId,
      quantity:    i.quantity,
      reason:      i.reason,
      productName: i.productName,
      variantName: i.variantName ?? null,
    })),
  };
}

export function buildCustomerOrderPayment(order: OrderPaymentRow): CustomerOrderPaymentPublic {
  const provider = resolveOrderPaymentProvider(order);
  const status = order.paymentStatus ? String(order.paymentStatus) : null;
  const providerLabel = adminListPaymentProviderLabel(provider);
  const statusLabel = adminListPaymentStatusLabel(status);
  const hint = buildCustomerPaymentHint(provider, status);

  return {
    provider,
    providerLabel,
    status,
    statusLabel,
    approvedAt: order.paymentApprovedAt ? order.paymentApprovedAt.toISOString() : null,
    failedAt:   order.paymentFailedAt ? order.paymentFailedAt.toISOString() : null,
    hint,
    methodLabel: providerLabel,
  };
}
