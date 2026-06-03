import { AuditLog } from '@prisma/client';
import { AuditAction } from '../audit/audit.service';

export interface OrderHistoryEntry {
  id:                   string;
  occurredAt:           string;
  actionType:           string;
  actionLabel:          string;
  previousStatus:       string | null;
  newStatus:            string | null;
  previousPaymentStatus: string | null;
  newPaymentStatus:     string | null;
  actorEmail:           string | null;
  note:                 string | null;
}

const RELEVANT_ACTIONS = new Set<string>([
  AuditAction.ORDER_CREATED,
  AuditAction.ORDER_STATUS_CHANGED,
  AuditAction.ORDER_UPDATED,
]);

const ACTION_LABELS: Record<string, string> = {
  [AuditAction.ORDER_CREATED]:        'Sipariş oluşturuldu',
  [AuditAction.ORDER_STATUS_CHANGED]: 'Sipariş durumu güncellendi',
  [AuditAction.ORDER_UPDATED]:        'Sipariş güncellendi',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  if (value == null || value === '') return null;
  return String(value);
}

function paymentNote(prev: string | null, next: string | null): string | null {
  if (!prev && !next) return null;
  if (prev && next && prev !== next) return `Ödeme durumu: ${prev} → ${next}`;
  if (next) return `Ödeme durumu: ${next}`;
  return null;
}

export function mapAuditLogsToOrderHistory(logs: AuditLog[]): OrderHistoryEntry[] {
  const relevant = logs
    .filter((log) => RELEVANT_ACTIONS.has(log.action))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let trackedStatus: string | null = null;
  const entries: OrderHistoryEntry[] = [];

  for (const log of relevant) {
    const details = asRecord(log.details);
    const action  = log.action;

    if (action === AuditAction.ORDER_CREATED) {
      const newStatus = str(details.initialStatus) ?? 'PENDING';
      entries.push({
        id:                    log.id,
        occurredAt:            log.createdAt.toISOString(),
        actionType:            action,
        actionLabel:           ACTION_LABELS[action] ?? action,
        previousStatus:        null,
        newStatus,
        previousPaymentStatus: null,
        newPaymentStatus:      str(details.paymentStatus),
        actorEmail:            log.userEmail,
        note:                  null,
      });
      trackedStatus = newStatus;
      continue;
    }

    if (action === AuditAction.ORDER_STATUS_CHANGED) {
      const newStatus     = str(details.newStatus);
      const previousStatus = str(details.previousStatus) ?? trackedStatus;
      entries.push({
        id:                    log.id,
        occurredAt:            log.createdAt.toISOString(),
        actionType:            action,
        actionLabel:           ACTION_LABELS[action] ?? action,
        previousStatus,
        newStatus,
        previousPaymentStatus: null,
        newPaymentStatus:      null,
        actorEmail:            log.userEmail,
        note:                  null,
      });
      if (newStatus) trackedStatus = newStatus;
      continue;
    }

    if (action === AuditAction.ORDER_UPDATED && details.paymentConfirmed === true) {
      const previousStatus = str(details.previousOrderStatus) ?? trackedStatus;
      const newStatus      = str(details.orderStatus) ?? trackedStatus;
      const prevPay        = str(details.previousPaymentStatus);
      const newPay         = str(details.paymentStatus);
      entries.push({
        id:                    log.id,
        occurredAt:            log.createdAt.toISOString(),
        actionType:            'ORDER_PAYMENT_CONFIRMED',
        actionLabel:           'Havale/EFT ödemesi onaylandı',
        previousStatus,
        newStatus,
        previousPaymentStatus: prevPay,
        newPaymentStatus:      newPay,
        actorEmail:            log.userEmail,
        note:                  paymentNote(prevPay, newPay),
      });
      if (newStatus) trackedStatus = newStatus;
    }
  }

  return entries.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}
