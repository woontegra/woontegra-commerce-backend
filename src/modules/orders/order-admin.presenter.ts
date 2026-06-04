import type {
  OrderPaymentStatus,
  OrderStatus,
  PaymentProviderType,
  StorePaymentSessionStatus,
} from '@prisma/client';
import {
  adminListPaymentProviderLabel,
  adminListPaymentStatusLabel,
  ORDER_PAYMENT_STATUS_LABELS,
  resolveOrderPaymentProvider,
} from './order-payment.util';

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v && typeof (v as { toNumber: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const PAYMENT_LABELS: Record<string, string> = {
  PAYTR:             'Kredi Kartı / PayTR',
  IYZICO:            'iyzico',
  BANK_TRANSFER:     'Havale / EFT',
  CASH_ON_DELIVERY:  'Kapıda Ödeme',
  BANK_POS:          'Banka POS',
};

export type AdminAddressView = {
  fullName:    string;
  phone:       string;
  addressLine: string;
  district:    string;
  city:        string;
  postalCode:  string;
};

export type AdminBillingAddressView = AdminAddressView & {
  sameAsShipping: boolean;
  type?:          'individual' | 'corporate';
  companyName?:   string;
  taxOffice?:     string;
  taxNumber?:     string;
};

export type AdminOrderTotals = {
  itemsSubtotal:      number;
  shippingPrice:      number;
  cashOnDeliveryFee:  number;
  couponDiscount:     number;
  campaignDiscount:   number;
  grandTotal:         number;
};

export type AdminPaymentSummary = {
  provider:           PaymentProviderType | string | null;
  methodLabel:        string;
  statusLabel:        string;
  sessionStatus:      StorePaymentSessionStatus | null;
  sessionProvider:    string | null;
};

export type AdminOrderMeta = {
  isStorefrontOrder:  boolean;
  payment:            AdminPaymentSummary;
  totals:             AdminOrderTotals;
  shippingAddress:    AdminAddressView | null;
  billingAddress:     AdminBillingAddressView | null;
  customerNote:       string | null;
  systemNoteLines:    string[];
};

type OrderRow = {
  id:               string;
  orderNumber:      string;
  status:           OrderStatus;
  totalAmount:      unknown;
  shippingPrice:    unknown;
  discountAmount:   unknown;
  campaignDiscount: unknown;
  currency:         string;
  notes:            string | null;
  paymentProvider?: PaymentProviderType | null;
  paymentStatus?:   OrderPaymentStatus | null;
  paymentApprovedAt?: Date | null;
  paymentFailedAt?:   Date | null;
  shippingCarrier?:        string | null;
  shippingTrackingNumber?: string | null;
  shippingTrackingUrl?:    string | null;
  shippedAt?:              Date | null;
  shippingNotificationSentAt?: Date | null;
  invoiceNumber?:     string | null;
  invoiceUrl?:        string | null;
  invoiceUploadedAt?: Date | null;
  createdAt:        Date;
  updatedAt:        Date;
  customer?: {
    firstName: string;
    lastName:  string;
    email:     string;
    phone?:    string | null;
    address?:  string | null;
    city?:     string | null;
    zipCode?:  string | null;
  } | null;
  items?: Array<{
    id:             string;
    quantity:       number;
    price:          unknown;
    discountAmount: unknown;
    product?:       { id: string; name: string; slug: string } | null;
    variant?:       { id: string; name: string; sku?: string | null } | null;
  }>;
  paymentSessions?: Array<{
    id:       string;
    provider: string;
    status:   StorePaymentSessionStatus;
  }>;
};

function parseAddressBlock(block: string): AdminAddressView | null {
  const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  let fullName = lines[0];
  let phone    = '';
  if (lines[0].includes('·')) {
    const parts = lines[0].split('·').map(p => p.trim());
    fullName = parts[0] ?? lines[0];
    phone    = parts[1] ?? '';
  }

  const addressLine = lines[1] ?? '';
  let district    = '';
  let city        = '';
  let postalCode  = '';

  if (lines[2]) {
    const loc = lines[2];
    const slash = loc.indexOf('/');
    if (slash >= 0) {
      district   = loc.slice(0, slash).trim();
      const rest = loc.slice(slash + 1).trim();
      const restParts = rest.split(/\s+/).filter(Boolean);
      city       = restParts[0] ?? '';
      postalCode = restParts.slice(1).join(' ');
    } else {
      city = loc;
    }
  }

  return { fullName, phone, addressLine, district, city, postalCode };
}

function extractSection(notes: string, header: string): string | null {
  const idx = notes.indexOf(`${header}:`);
  if (idx < 0) return null;
  const after = notes.slice(idx + header.length + 1).replace(/^\n/, '');
  const endMarkers = ['\n\nTeslimat:', '\n\nFatura:', '\n\n[', '\n\nKurumsal:'];
  let end = after.length;
  for (const m of endMarkers) {
    const i = after.indexOf(m);
    if (i >= 0) end = Math.min(end, i);
  }
  const block = after.slice(0, end).trim();
  return block || null;
}

function parseNotesMeta(notes: string | null) {
  const text = notes ?? '';
  const paymentMatch = text.match(/\[Ödeme yöntemi:\s*([^\]]+)\]/i);
  const paymentProvider = paymentMatch?.[1]?.trim() ?? null;

  const codMatch = text.match(/\[Kapıda ödeme ek ücreti:\s*([\d.,]+)\s*₺\]/i);
  const cashOnDeliveryFee = codMatch
    ? parseFloat(codMatch[1].replace(',', '.')) || 0
    : 0;

  const isStorefrontOrder =
    text.includes('[Vitrin siparişi') ||
    text.includes('[Ödeme yöntemi:') ||
    text.includes('Teslimat:');

  const systemNoteLines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('['));

  const customerNote = text
    .split('\n\n')[0]
    ?.trim()
    .replace(/^\[.*\].*$/gm, '')
    .trim() || null;

  const deliveryBlock = extractSection(text, 'Teslimat');
  const invoiceBlock  = extractSection(text, 'Fatura');

  let corporate: { companyName?: string; taxNumber?: string; taxOffice?: string } = {};
  const corpMatch = text.match(/Kurumsal:\s*(.+?)(?:\s*·\s*VKN:\s*([^\s·]+))?(?:\s*·\s*VD:\s*(.+))?$/im);
  if (corpMatch) {
    corporate = {
      companyName: corpMatch[1]?.trim(),
      taxNumber:   corpMatch[2]?.trim(),
      taxOffice:   corpMatch[3]?.trim(),
    };
  }

  return {
    paymentProvider,
    cashOnDeliveryFee,
    isStorefrontOrder,
    systemNoteLines,
    customerNote: customerNote && !customerNote.startsWith('[') ? customerNote : null,
    deliveryBlock,
    invoiceBlock,
    corporate,
    hasInvoice: Boolean(invoiceBlock),
  };
}

function resolvePaymentSummary(
  order: OrderRow,
  parsed: ReturnType<typeof parseNotesMeta>,
  session: OrderRow['paymentSessions'] extends (infer U)[] | undefined ? U | undefined : undefined,
): AdminPaymentSummary {
  const provider = resolveOrderPaymentProvider({
    paymentProvider: order.paymentProvider,
    notes:           order.notes,
  }) ?? (session?.provider ?? parsed.paymentProvider) as PaymentProviderType | string | null;

  const methodLabel = provider
    ? (PAYMENT_LABELS[String(provider)] ?? String(provider))
    : 'Belirtilmemiş';

  let statusLabel = '—';
  const st = order.status;

  if (order.paymentStatus) {
    statusLabel = ORDER_PAYMENT_STATUS_LABELS[order.paymentStatus] ?? String(order.paymentStatus);
  } else {
    if (session?.provider === 'PAYTR') {
      if (session.status === 'SUCCESS') statusLabel = 'Ödeme alındı (PayTR)';
      else if (session.status === 'FAILED') statusLabel = 'Ödeme başarısız (PayTR)';
      else statusLabel = 'PayTR ödeme bekleniyor';
    } else if (provider === 'BANK_TRANSFER') {
      statusLabel = st === 'PENDING' ? 'Havale/EFT bekleniyor' : 'Havale/EFT (onaylı süreç)';
    } else if (provider === 'CASH_ON_DELIVERY') {
      statusLabel = st === 'CANCELLED' ? 'İptal' : 'Kapıda ödeme — tahsilat teslimatta';
    }

    if (st === 'PAID') statusLabel = 'Ödendi';
    if (st === 'CANCELLED') statusLabel = 'İptal edildi';
  }

  return {
    provider,
    methodLabel,
    statusLabel,
    sessionStatus:   session?.status ?? null,
    sessionProvider: session?.provider ?? null,
  };
}

function computeTotals(order: OrderRow, parsed: ReturnType<typeof parseNotesMeta>): AdminOrderTotals {
  const items = order.items ?? [];
  const itemsSubtotal = items.reduce(
    (s, i) => s + num(i.price) * i.quantity,
    0,
  );
  const shippingPrice     = num(order.shippingPrice);
  const couponDiscount    = num(order.discountAmount);
  const campaignDiscount  = num(order.campaignDiscount);
  const grandTotal        = num(order.totalAmount);

  let cashOnDeliveryFee = parsed.cashOnDeliveryFee;
  if (cashOnDeliveryFee <= 0 && parsed.paymentProvider === 'CASH_ON_DELIVERY') {
    const derived =
      grandTotal - itemsSubtotal + couponDiscount + campaignDiscount - shippingPrice;
    if (derived > 0.001) cashOnDeliveryFee = Math.round(derived * 100) / 100;
  }

  return {
    itemsSubtotal:     Math.round(itemsSubtotal * 100) / 100,
    shippingPrice:     Math.round(shippingPrice * 100) / 100,
    cashOnDeliveryFee: Math.round(cashOnDeliveryFee * 100) / 100,
    couponDiscount:    Math.round(couponDiscount * 100) / 100,
    campaignDiscount:  Math.round(campaignDiscount * 100) / 100,
    grandTotal:        Math.round(grandTotal * 100) / 100,
  };
}

function buildAddresses(
  order: OrderRow,
  parsed: ReturnType<typeof parseNotesMeta>,
): { shipping: AdminAddressView | null; billing: AdminBillingAddressView | null } {
  let shipping = parsed.deliveryBlock ? parseAddressBlock(parsed.deliveryBlock) : null;

  if (!shipping && order.customer?.address) {
    shipping = parseAddressBlock(order.customer.address);
  }

  if (!shipping && order.customer) {
    shipping = {
      fullName:    `${order.customer.firstName} ${order.customer.lastName}`.trim(),
      phone:       order.customer.phone ?? '',
      addressLine: order.customer.address ?? '',
      district:    '',
      city:        order.customer.city ?? '',
      postalCode:  order.customer.zipCode ?? '',
    };
  }

  let billing: AdminBillingAddressView | null = null;
  if (parsed.invoiceBlock) {
    const parsedBill = parseAddressBlock(parsed.invoiceBlock);
    if (parsedBill) {
      billing = {
        ...parsedBill,
        sameAsShipping: false,
        type:           parsed.corporate.companyName ? 'corporate' : 'individual',
        companyName:    parsed.corporate.companyName,
        taxNumber:      parsed.corporate.taxNumber,
        taxOffice:      parsed.corporate.taxOffice,
      };
    }
  } else if (!parsed.hasInvoice) {
    billing = shipping
      ? { ...shipping, sameAsShipping: true, type: 'individual' as const }
      : null;
  }

  return { shipping, billing };
}

export function buildAdminOrderMeta(order: OrderRow): AdminOrderMeta {
  const parsed  = parseNotesMeta(order.notes);
  const session = order.paymentSessions?.[0];
  const totals  = computeTotals(order, parsed);
  const { shipping, billing } = buildAddresses(order, parsed);

  return {
    isStorefrontOrder: parsed.isStorefrontOrder,
    payment:           resolvePaymentSummary(order, parsed, session),
    totals,
    shippingAddress:   shipping,
    billingAddress:    billing,
    customerNote:      parsed.customerNote,
    systemNoteLines:   parsed.systemNoteLines,
  };
}

/** Prisma order → admin API JSON (numbers normalized). */
export function toAdminOrderJson(order: OrderRow) {
  const items = (order.items ?? []).map(i => ({
    id:             i.id,
    quantity:       i.quantity,
    price:          num(i.price),
    discountAmount: num(i.discountAmount),
    lineTotal:      Math.round(num(i.price) * i.quantity * 100) / 100,
    productId:      i.product?.id,
    product:        i.product ?? null,
    variantId:      i.variant?.id ?? null,
    variant:        i.variant ?? null,
  }));

  const paymentProviderResolved = resolveOrderPaymentProvider({
    paymentProvider: order.paymentProvider,
    notes:           order.notes,
  });

  return {
    id:               order.id,
    orderNumber:      order.orderNumber,
    status:           order.status,
    paymentProvider:  paymentProviderResolved,
    paymentStatus:    order.paymentStatus ?? null,
    paymentApprovedAt: order.paymentApprovedAt ?? null,
    paymentFailedAt:   order.paymentFailedAt ?? null,
    shippingCarrier:        order.shippingCarrier ?? null,
    shippingTrackingNumber: order.shippingTrackingNumber ?? null,
    shippingTrackingUrl:    order.shippingTrackingUrl ?? null,
    shippedAt:              order.shippedAt ?? null,
    shippingNotificationSentAt: order.shippingNotificationSentAt ?? null,
    invoiceNumber:     order.invoiceNumber ?? null,
    invoiceUrl:        order.invoiceUrl ?? null,
    invoiceUploadedAt: order.invoiceUploadedAt ?? null,
    totalAmount:      num(order.totalAmount),
    shippingPrice:    num(order.shippingPrice),
    discountAmount:   num(order.discountAmount),
    campaignDiscount: num(order.campaignDiscount),
    currency:         order.currency,
    notes:            order.notes,
    createdAt:        order.createdAt,
    updatedAt:        order.updatedAt,
    customer:         order.customer ?? null,
    items,
    paymentSession: order.paymentSessions?.[0]
      ? {
          id:       order.paymentSessions[0].id,
          provider: order.paymentSessions[0].provider,
          status:   order.paymentSessions[0].status,
        }
      : null,
    admin: buildAdminOrderMeta(order),
  };
}

export function toAdminOrderListJson(orders: OrderRow[]) {
  return orders.map(o => {
    const full = toAdminOrderJson(o);
    const providerLabel = adminListPaymentProviderLabel(full.paymentProvider);
    const statusLabel = full.paymentStatus
      ? adminListPaymentStatusLabel(full.paymentStatus)
      : (full.admin.payment.statusLabel === '—' ? 'Belirsiz' : full.admin.payment.statusLabel);

    return {
      id:               full.id,
      orderNumber:      full.orderNumber,
      status:           full.status,
      paymentProvider:  full.paymentProvider,
      paymentStatus:    full.paymentStatus,
      paymentApprovedAt: full.paymentApprovedAt,
      paymentFailedAt:   full.paymentFailedAt,
      invoiceNumber:     full.invoiceNumber,
      invoiceUrl:        full.invoiceUrl,
      invoiceUploadedAt: full.invoiceUploadedAt,
      shippingCarrier:        full.shippingCarrier,
      shippingTrackingNumber: full.shippingTrackingNumber,
      shippingTrackingUrl:    full.shippingTrackingUrl,
      totalAmount:      full.totalAmount,
      shippingPrice:    full.shippingPrice,
      discountAmount:   full.discountAmount,
      campaignDiscount: full.campaignDiscount,
      currency:         full.currency,
      createdAt:        full.createdAt,
      updatedAt:        full.updatedAt,
      customer:         full.customer,
      items:            full.items,
      payment: {
        provider:       full.paymentProvider,
        providerLabel,
        status:         full.paymentStatus,
        statusLabel,
      },
      admin: {
        isStorefrontOrder: full.admin.isStorefrontOrder,
        payment:           full.admin.payment,
        totals:            full.admin.totals,
      },
    };
  });
}
