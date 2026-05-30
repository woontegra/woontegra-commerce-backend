import type { OrderStatus, TrendyolOrder } from '@prisma/client';
import type { toAdminOrderListJson } from './order-admin.presenter';

export type UnifiedOrderSource = 'STOREFRONT' | 'TRENDYOL';

export type StorefrontListItem = ReturnType<typeof toAdminOrderListJson>[number];

export interface UnifiedOrderDTO {
  id:                   string;
  source:               UnifiedOrderSource;
  sourceLabel:          string;
  displayOrderNumber:   string;
  customerName:         string;
  customerEmail?:       string;
  totalAmount:          number;
  currency:             string;
  fulfillmentStatus:    string;
  externalStatus?:      string;
  paymentProvider?:     string | null;
  paymentStatus?:       string | null;
  cargoTrackingNumber?: string | null;
  orderDate:            string;
  sourceSyncedAt?:      string;
  canEditStatus:        boolean;
  canEditShipping:      boolean;
}

const TRENDYOL_STATUS_LABELS: Record<string, string> = {
  Created:     'Yeni',
  Picking:     'Hazırlanıyor',
  Invoiced:    'Faturalandı',
  Shipped:     'Kargoda',
  Delivered:   'Teslim',
  Cancelled:   'İptal',
  UnDelivered: 'Teslim Edilemedi',
  Returned:    'İade',
};

/** Trendyol status → panel OrderStatus benzeri fulfillment kodu. */
export function mapTrendyolToFulfillment(status: string): OrderStatus {
  const s = status.trim();
  if (s === 'Created' || s === 'Picking') return 'PROCESSING';
  if (s === 'Invoiced') return 'PAID';
  if (s === 'Shipped') return 'SHIPPED';
  if (s === 'Delivered') return 'DELIVERED';
  if (s === 'Cancelled') return 'CANCELLED';
  return 'PROCESSING';
}

/** Storefront status filtresi → Trendyol ham status listesi. */
export function trendyolStatusesForFilter(status: OrderStatus): string[] {
  const map: Record<OrderStatus, string[]> = {
    PENDING:    [],
    PROCESSING: ['Created', 'Picking'],
    PAID:       ['Invoiced'],
    SHIPPED:    ['Shipped'],
    DELIVERED:  ['Delivered'],
    CANCELLED:  ['Cancelled'],
  };
  return map[status] ?? [];
}

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v && typeof (v as { toNumber: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toIso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function mapStorefrontListItemToUnified(item: StorefrontListItem): UnifiedOrderDTO & StorefrontListItem {
  const customerName = item.customer
    ? `${item.customer.firstName} ${item.customer.lastName}`.trim()
    : '—';

  return {
    ...item,
    source:               'STOREFRONT',
    sourceLabel:          'Woontegra',
    displayOrderNumber:   item.orderNumber,
    customerName,
    customerEmail:        item.customer?.email ?? undefined,
    totalAmount:          num(item.totalAmount),
    currency:             item.currency,
    fulfillmentStatus:    item.status,
    paymentProvider:      item.paymentProvider ?? item.payment?.provider ?? null,
    paymentStatus:        item.paymentStatus ?? item.payment?.status ?? null,
    cargoTrackingNumber:  null,
    orderDate:            toIso(item.createdAt),
    sourceSyncedAt:       toIso(item.updatedAt),
    canEditStatus:        true,
    canEditShipping:      true,
  };
}

export function mapTrendyolOrderToUnified(order: TrendyolOrder): UnifiedOrderDTO & Record<string, unknown> {
  const customerName = [order.customerFirstName, order.customerLastName]
    .filter(Boolean)
    .join(' ')
    .trim() || '—';

  const fulfillment = mapTrendyolToFulfillment(order.status);

  return {
    id:                   order.id,
    source:               'TRENDYOL',
    sourceLabel:          'Trendyol',
    displayOrderNumber:   order.orderNumber,
    customerName,
    customerEmail:        order.customerEmail ?? undefined,
    totalAmount:          num(order.totalPrice),
    currency:             'TRY',
    fulfillmentStatus:    fulfillment,
    externalStatus:       order.status,
    paymentProvider:      null,
    paymentStatus:        null,
    cargoTrackingNumber:  order.cargoTrackingNumber,
    orderDate:            order.orderDate.toISOString(),
    sourceSyncedAt:       order.updatedAt.toISOString(),
    canEditStatus:        false,
    canEditShipping:      false,
    // Liste UI uyumluluğu (read-only)
    orderNumber:          order.orderNumber,
    status:               fulfillment,
    createdAt:            order.orderDate.toISOString(),
    updatedAt:            order.updatedAt.toISOString(),
    customer: order.customerFirstName || order.customerEmail
      ? {
          firstName: order.customerFirstName ?? '',
          lastName:  order.customerLastName ?? '',
          email:     order.customerEmail ?? '',
        }
      : null,
    items: [],
    payment: {
      provider:      null,
      providerLabel: 'Pazaryeri',
      status:        null,
      statusLabel:   'Pazaryeri',
    },
    externalStatusLabel: TRENDYOL_STATUS_LABELS[order.status] ?? order.status,
  };
}

export function unifiedSortKey(orderDate: string): number {
  const t = new Date(orderDate).getTime();
  return Number.isFinite(t) ? t : 0;
}
