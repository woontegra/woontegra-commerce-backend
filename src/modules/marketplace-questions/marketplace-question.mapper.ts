import type { MarketplaceQuestion } from '@prisma/client';
import {
  MARKETPLACE_QUESTION_SOURCE_LABELS,
  type ExternalQuestionRecord,
  type MarketplaceQuestionDTO,
} from './marketplace-question.types';
import type { MarketplaceQuestionStatus } from '@prisma/client';

/** Trendyol external status → Woontegra normalize status */
export function mapTrendyolQuestionStatus(externalStatus: string | null | undefined): MarketplaceQuestionStatus {
  const norm = String(externalStatus ?? '').trim().toUpperCase();

  switch (norm) {
    case 'WAITING_FOR_ANSWER':
      return 'WAITING_ANSWER';
    case 'WAITING_FOR_APPROVE':
      return 'PENDING_APPROVAL';
    case 'ANSWERED':
      return 'ANSWERED';
    case 'UNANSWERED':
      return 'EXPIRED';
    case 'REJECTED':
    case 'REPORTED':
      return 'CLOSED';
    default:
      return 'WAITING_ANSWER';
  }
}

export function toMarketplaceQuestionDTO(row: MarketplaceQuestion): MarketplaceQuestionDTO {
  return {
    id:                 row.id,
    tenantId:           row.tenantId,
    source:             row.source,
    sourceLabel:        MARKETPLACE_QUESTION_SOURCE_LABELS[row.source] ?? row.source,
    type:               row.type,
    externalQuestionId: row.externalQuestionId,
    externalStatus:     row.externalStatus,
    status:             row.status,
    questionText:       row.questionText,
    answerText:         row.answerText,
    customerName:       row.customerName,
    customerId:         row.customerId,
    productName:        row.productName,
    barcode:            row.barcode,
    externalProductId:  row.externalProductId,
    externalOrderId:    row.externalOrderId,
    productId:          row.productId,
    orderId:            row.orderId,
    askedAt:            row.askedAt.toISOString(),
    answeredAt:         row.answeredAt?.toISOString() ?? null,
    lastSyncedAt:       row.lastSyncedAt?.toISOString() ?? null,
    rawPayload:         row.rawPayload ?? undefined,
  };
}

/** Trendyol Q&A API yanıtını güvenli external kayda dönüştürür. */
export function mapTrendyolQuestionPayload(raw: unknown): ExternalQuestionRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;

  const id = item.id ?? item.questionId;
  if (id == null || String(id).trim() === '') return null;

  const questionText = String(item.text ?? item.questionText ?? '').trim();
  if (!questionText) return null;

  const externalStatus = item.status != null ? String(item.status) : null;
  const answerObj = item.answer && typeof item.answer === 'object'
    ? item.answer as Record<string, unknown>
    : null;
  const answerText = answerObj?.text != null
    ? String(answerObj.text).trim()
    : (item.answerText != null ? String(item.answerText).trim() : null);

  const creationMs = Number(item.creationDate ?? item.createdDate ?? 0);
  const askedAt = Number.isFinite(creationMs) && creationMs > 0
    ? new Date(creationMs)
    : new Date();

  const answerMs = Number(answerObj?.creationDate ?? item.answeredDate ?? 0);
  const answeredAt = answerText && Number.isFinite(answerMs) && answerMs > 0
    ? new Date(answerMs)
    : null;

  const productMainId = item.productMainId ?? item.productId;

  return {
    externalQuestionId: String(id),
    externalStatus,
    status:             mapTrendyolQuestionStatus(externalStatus),
    type:               'PRODUCT_QUESTION',
    questionText,
    answerText:         answerText || null,
    customerName:       item.userName != null ? String(item.userName).trim() || null : null,
    customerId:         item.customerId != null ? String(item.customerId) : null,
    productName:        item.productName != null ? String(item.productName) : null,
    barcode:            item.barcode != null ? String(item.barcode) : null,
    externalProductId:  productMainId != null ? String(productMainId) : null,
    externalOrderId:    null,
    askedAt,
    answeredAt,
    rawPayload:         item,
  };
}
