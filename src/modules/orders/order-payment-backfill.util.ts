import type {
  OrderPaymentStatus,
  OrderStatus,
  PaymentProviderType,
  StorePaymentSessionStatus,
} from '@prisma/client';
import { PAYMENT_PROVIDER_TYPES } from '../payments/payment-provider.types';
import { parseOrderPaymentProviderFromNotes } from './order-payment.util';

export type BackfillPaymentSessionRow = {
  provider: string;
  status:   StorePaymentSessionStatus;
  updatedAt: Date;
  createdAt: Date;
};

export type BackfillOrderRow = {
  id: string;
  orderNumber: string;
  tenantId: string;
  status: OrderStatus;
  notes: string | null;
  paymentProvider: PaymentProviderType | null;
  paymentStatus: OrderPaymentStatus | null;
  paymentApprovedAt: Date | null;
  paymentFailedAt: Date | null;
  bankTransferApprovedEmailSentAt?: Date | null;
  shippingCarrier?: string | null;
  shippingTrackingNumber?: string | null;
  shippedAt?: Date | null;
  updatedAt: Date;
  paymentSessions: BackfillPaymentSessionRow[];
};

export type BackfillPatch = {
  paymentProvider?: PaymentProviderType;
  paymentStatus?: OrderPaymentStatus;
  paymentApprovedAt?: Date;
  paymentFailedAt?: Date;
};

export type BackfillDecision = {
  patch: BackfillPatch;
  willUpdateProvider: boolean;
  willUpdateStatus: boolean;
  willUpdatePaymentApprovedAt: boolean;
  willUpdatePaymentFailedAt: boolean;
  providerSource: 'existing' | 'session' | 'notes' | null;
  unresolvedProvider: boolean;
  statusSkippedUnsafe: boolean;
  skippedAlreadyFilled: boolean;
};

const KNOWN_PROVIDERS = new Set<string>(PAYMENT_PROVIDER_TYPES);

/** Desteklenen enum değerine normalize eder; tahmin yoksa null. */
export function normalizePaymentProvider(
  value: string | null | undefined,
): PaymentProviderType | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
  if (KNOWN_PROVIDERS.has(upper)) return upper as PaymentProviderType;

  const lower = raw.toLowerCase();
  if (lower.includes('paytr') || (lower.includes('kredi') && lower.includes('kart'))) {
    return 'PAYTR';
  }
  if (lower.includes('iyzico')) return 'IYZICO';
  if (lower.includes('havale') || lower.includes('eft') || lower.includes('bank_transfer')) {
    return 'BANK_TRANSFER';
  }
  if (lower.includes('kapıda') || lower.includes('kapida') || lower.includes('cash_on_delivery')) {
    return 'CASH_ON_DELIVERY';
  }
  if (lower.includes('bank_pos') || lower.includes('sanal pos')) {
    return 'BANK_POS';
  }
  return null;
}

/** Türkçe / eski not formatları — yalnızca açık ipuçları. */
export function inferPaymentProviderFromNotesHeuristics(
  notes: string | null | undefined,
): PaymentProviderType | null {
  const text = notes ?? '';
  const explicit = parseOrderPaymentProviderFromNotes(text);
  const fromBracket = normalizePaymentProvider(explicit);
  if (fromBracket) return fromBracket;

  const lower = text.toLowerCase();
  if (/\[kapıda ödeme/i.test(text) || /\[ödeme yöntemi:\s*cash/i.test(text)) {
    return 'CASH_ON_DELIVERY';
  }
  if (/\[havale\/eft/i.test(text) || /\[ödeme yöntemi:\s*bank_transfer/i.test(text)) {
    return 'BANK_TRANSFER';
  }
  if (/\[paytr\]/i.test(text) || /\[ödeme yöntemi:\s*paytr/i.test(text)) {
    return 'PAYTR';
  }
  if (/kapıda\s*ödeme|kapida\s*odeme/.test(lower) && !/paytr|kredi\s*kart/i.test(lower)) {
    return 'CASH_ON_DELIVERY';
  }
  if (/havale|eft/.test(lower) && !/kapıda|kapida/.test(lower)) {
    return 'BANK_TRANSFER';
  }
  if (/paytr/.test(lower)) return 'PAYTR';
  return null;
}

const SESSION_STATUS_RANK: Record<StorePaymentSessionStatus, number> = {
  SUCCESS:   3,
  FAILED:    2,
  INITIATED: 1,
};

/** StorePaymentSession — notes’tan önce (backfill kuralı A). */
export function pickPaymentSessionForBackfill(
  sessions: BackfillPaymentSessionRow[],
): BackfillPaymentSessionRow | null {
  if (!sessions.length) return null;
  return [...sessions].sort((a, b) => {
    const dr = SESSION_STATUS_RANK[b.status] - SESSION_STATUS_RANK[a.status];
    if (dr !== 0) return dr;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  })[0]!;
}

export function inferPaymentProviderForBackfill(
  order: BackfillOrderRow,
): { provider: PaymentProviderType | null; source: BackfillDecision['providerSource'] } {
  if (order.paymentProvider) {
    return { provider: order.paymentProvider, source: 'existing' };
  }

  const session = pickPaymentSessionForBackfill(order.paymentSessions);
  if (session) {
    const fromSession = normalizePaymentProvider(session.provider);
    if (fromSession) return { provider: fromSession, source: 'session' };
  }

  const fromNotes = inferPaymentProviderFromNotesHeuristics(order.notes);
  if (fromNotes) return { provider: fromNotes, source: 'notes' };

  return { provider: null, source: null };
}

export function hasBankTransferApprovalEvidence(order: BackfillOrderRow): boolean {
  if (order.bankTransferApprovedEmailSentAt) return true;
  if (order.status === 'PAID') return true;
  const notes = order.notes ?? '';
  if (/havale.*onay|ödeme\s*onaylandı|bank_transfer.*approved/i.test(notes)) return true;
  if (/\[Havale\/EFT/i.test(notes) && !/bekleniyor/i.test(notes) && order.status !== 'PENDING') {
    return true;
  }
  return false;
}

/** Dolu / anlamlı paymentStatus — ezilmez. */
export function isPaymentStatusLocked(status: OrderPaymentStatus | null | undefined): boolean {
  if (status == null) return false;
  return status !== 'PENDING';
}

export function inferPaymentStatusForBackfill(
  order: BackfillOrderRow,
  provider: PaymentProviderType,
  session: BackfillPaymentSessionRow | null,
): { status: OrderPaymentStatus | null; unsafe: boolean } {
  const st = order.status;

  if (provider === 'PAYTR') {
    if (session?.status === 'SUCCESS') return { status: 'PAID', unsafe: false };
    if (session?.status === 'FAILED') return { status: 'FAILED', unsafe: false };
    if (st === 'PAID') return { status: 'PAID', unsafe: false };
    if (st === 'CANCELLED') {
      if (session?.status === 'FAILED') return { status: 'FAILED', unsafe: false };
      return { status: null, unsafe: true };
    }
    return { status: 'PENDING', unsafe: false };
  }

  if (provider === 'BANK_TRANSFER') {
    if (st === 'CANCELLED') return { status: 'CANCELLED', unsafe: false };
    if (st === 'PENDING') return { status: 'WAITING_BANK_TRANSFER', unsafe: false };
    if (st === 'PAID') return { status: 'PAID', unsafe: false };
    if (hasBankTransferApprovalEvidence(order)) {
      return { status: 'PAID', unsafe: false };
    }
    return { status: null, unsafe: true };
  }

  if (provider === 'CASH_ON_DELIVERY') {
    if (st === 'CANCELLED') return { status: 'CANCELLED', unsafe: false };
    return { status: 'PENDING', unsafe: false };
  }

  if (st === 'CANCELLED') return { status: 'CANCELLED', unsafe: false };
  return { status: 'PENDING', unsafe: false };
}

export function inferPaymentApprovedAt(
  order: BackfillOrderRow,
  provider: PaymentProviderType,
  newStatus: OrderPaymentStatus | null,
  session: BackfillPaymentSessionRow | null,
): Date | null {
  if (order.paymentApprovedAt) return null;
  if (!newStatus || (newStatus !== 'PAID' && newStatus !== 'APPROVED')) return null;

  if (session?.status === 'SUCCESS') return session.updatedAt;

  if (provider === 'BANK_TRANSFER' && order.bankTransferApprovedEmailSentAt) {
    return order.bankTransferApprovedEmailSentAt;
  }

  return null;
}

export function inferPaymentFailedAt(
  order: BackfillOrderRow,
  newStatus: OrderPaymentStatus | null,
  session: BackfillPaymentSessionRow | null,
): Date | null {
  if (order.paymentFailedAt) return null;
  if (newStatus !== 'FAILED') return null;
  if (session?.status === 'FAILED') return session.updatedAt;
  return null;
}

export function buildOrderPaymentBackfillPatch(order: BackfillOrderRow): BackfillDecision {
  const empty: BackfillDecision = {
    patch: {},
    willUpdateProvider: false,
    willUpdateStatus: false,
    willUpdatePaymentApprovedAt: false,
    willUpdatePaymentFailedAt: false,
    providerSource: null,
    unresolvedProvider: false,
    statusSkippedUnsafe: false,
    skippedAlreadyFilled: true,
  };

  const { provider: inferredProvider, source } = inferPaymentProviderForBackfill(order);
  const effectiveProvider = order.paymentProvider ?? inferredProvider;

  if (!effectiveProvider) {
    return {
      ...empty,
      unresolvedProvider: !order.paymentProvider,
      skippedAlreadyFilled: false,
    };
  }

  const patch: BackfillPatch = {};
  let willUpdateProvider = false;
  let willUpdateStatus = false;
  let willUpdatePaymentApprovedAt = false;
  let willUpdatePaymentFailedAt = false;
  let statusSkippedUnsafe = false;
  let skippedAlreadyFilled = true;

  if (!order.paymentProvider && inferredProvider) {
    patch.paymentProvider = inferredProvider;
    willUpdateProvider = true;
    skippedAlreadyFilled = false;
  }

  const session = pickPaymentSessionForBackfill(order.paymentSessions);
  const statusLocked = isPaymentStatusLocked(order.paymentStatus);

  if (!statusLocked) {
    const { status: inferredStatus, unsafe } = inferPaymentStatusForBackfill(
      order,
      effectiveProvider,
      session,
    );
    if (unsafe) {
      statusSkippedUnsafe = true;
    } else if (inferredStatus && inferredStatus !== order.paymentStatus) {
      patch.paymentStatus = inferredStatus;
      willUpdateStatus = true;
      skippedAlreadyFilled = false;

      const approvedAt = inferPaymentApprovedAt(order, effectiveProvider, inferredStatus, session);
      if (approvedAt) {
        patch.paymentApprovedAt = approvedAt;
        willUpdatePaymentApprovedAt = true;
      }

      const failedAt = inferPaymentFailedAt(order, inferredStatus, session);
      if (failedAt) {
        patch.paymentFailedAt = failedAt;
        willUpdatePaymentFailedAt = true;
      }
    }
  }

  if (!order.paymentApprovedAt && !patch.paymentApprovedAt) {
    const approvedAt = inferPaymentApprovedAt(
      order,
      effectiveProvider,
      order.paymentStatus ?? patch.paymentStatus ?? null,
      session,
    );
    if (approvedAt) {
      patch.paymentApprovedAt = approvedAt;
      willUpdatePaymentApprovedAt = true;
      skippedAlreadyFilled = false;
    }
  }

  if (!order.paymentFailedAt && !patch.paymentFailedAt) {
    const failedAt = inferPaymentFailedAt(
      order,
      patch.paymentStatus ?? order.paymentStatus ?? null,
      session,
    );
    if (failedAt) {
      patch.paymentFailedAt = failedAt;
      willUpdatePaymentFailedAt = true;
      skippedAlreadyFilled = false;
    }
  }

  return {
    patch,
    willUpdateProvider,
    willUpdateStatus,
    willUpdatePaymentApprovedAt,
    willUpdatePaymentFailedAt,
    providerSource: order.paymentProvider ? 'existing' : source,
    unresolvedProvider: !effectiveProvider,
    statusSkippedUnsafe,
    skippedAlreadyFilled: skippedAlreadyFilled && !willUpdateProvider,
  };
}

/** Kargo alanları — yalnızca rapor (bu adımda yazılmaz). */
export function countShippingBackfillGaps(order: BackfillOrderRow): {
  missingShippedAt: boolean;
  missingTrackingFields: boolean;
} {
  const shippedLike = order.status === 'SHIPPED' || order.status === 'DELIVERED';
  return {
    missingShippedAt: shippedLike && !order.shippedAt,
    missingTrackingFields:
      shippedLike && !order.shippingCarrier && !order.shippingTrackingNumber,
  };
}

export function truncateNotes(notes: string | null, max = 120): string {
  const s = (notes ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s || '—';
  return `${s.slice(0, max)}…`;
}
