import prisma from '../../config/database';
import { logger } from '../../config/logger';
import type { RefundMethod, RefundRecordStatus, ReturnRequestType } from '@prisma/client';
import { storeEmailService } from '../store-public/store-email.service';

export const REFUND_METHODS: RefundMethod[] = [
  'MANUAL_BANK_TRANSFER',
  'CASH',
  'PAYTR_MANUAL',
  'IYZICO_MANUAL',
  'OTHER',
];

export const REFUND_METHOD_LABELS: Record<RefundMethod, string> = {
  MANUAL_BANK_TRANSFER: 'Banka havalesi',
  CASH:                 'Nakit',
  PAYTR_MANUAL:         'PayTR (manuel)',
  IYZICO_MANUAL:        'iyzico (manuel)',
  OTHER:                'Diğer',
};

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export type RefundSummary = {
  refundableAmount: number;
  refundedAmount: number;
  remainingAmount: number;
  currency: string;
};

export type RefundRecordDto = {
  id: string;
  returnRequestId: string;
  orderId: string;
  amount: number;
  currency: string;
  method: RefundMethod;
  methodLabel: string;
  status: RefundRecordStatus;
  note: string | null;
  refundedAt: Date;
  createdAt: Date;
};

export type CustomerRefundDto = {
  amount: number;
  currency: string;
  refundedAt: Date;
  methodLabel: string;
};

function mapRefundRecord(row: {
  id: string;
  returnRequestId: string;
  orderId: string;
  amount: unknown;
  currency: string;
  method: RefundMethod;
  status: RefundRecordStatus;
  note: string | null;
  refundedAt: Date;
  createdAt: Date;
}): RefundRecordDto {
  return {
    id:              row.id,
    returnRequestId: row.returnRequestId,
    orderId:         row.orderId,
    amount:          num(row.amount),
    currency:        row.currency,
    method:          row.method,
    methodLabel:     REFUND_METHOD_LABELS[row.method],
    status:          row.status,
    note:            row.note,
    refundedAt:      row.refundedAt,
    createdAt:       row.createdAt,
  };
}

async function loadRequestForRefund(returnRequestId: string, tenantId: string) {
  return prisma.orderReturnRequest.findFirst({
    where: { id: returnRequestId, tenantId },
    include: {
      items: {
        include: { orderItem: { select: { quantity: true, price: true } } },
      },
      order: { select: { id: true, currency: true, items: { select: { quantity: true, price: true } } } },
    },
  });
}

/** Ürün tutarı; kargo dahil değil (TODO: opsiyonel kargo iadesi). */
export async function computeRefundableAmount(
  type: ReturnRequestType,
  requestId: string,
  tenantId: string,
): Promise<{ amount: number; currency: string }> {
  const request = await loadRequestForRefund(requestId, tenantId);
  if (!request) {
    throw new Error('Talep bulunamadı.');
  }

  let amount = 0;
  if (type === 'RETURN_REQUEST') {
    for (const item of request.items) {
      const unit = num(item.orderItem.price);
      amount += item.quantity * unit;
    }
  } else {
    for (const oi of request.order.items) {
      amount += oi.quantity * num(oi.price);
    }
  }

  return { amount: roundMoney(amount), currency: request.order.currency };
}

function assertRefundAllowed(
  type: ReturnRequestType,
  status: string,
): void {
  if (type === 'RETURN_REQUEST' && status !== 'COMPLETED') {
    throw new Error('İade talebi için para iadesi kaydı, talep tamamlandıktan sonra oluşturulabilir.');
  }
  if (type === 'CANCEL_REQUEST' && !['APPROVED', 'COMPLETED'].includes(status)) {
    throw new Error('İptal talebi için para iadesi kaydı, talep onaylandıktan sonra oluşturulabilir.');
  }
}

export class ReturnRefundService {
  async getSummary(returnRequestId: string, tenantId: string): Promise<{
    summary: RefundSummary;
    refunds: RefundRecordDto[];
  }> {
    const request = await loadRequestForRefund(returnRequestId, tenantId);
    if (!request) {
      throw new Error('Talep bulunamadı.');
    }

    const { amount: refundableAmount, currency } = await computeRefundableAmount(
      request.type,
      returnRequestId,
      tenantId,
    );

    const refunds = await prisma.returnRefundRecord.findMany({
      where:   { returnRequestId, tenantId },
      orderBy: { refundedAt: 'desc' },
    });

    const refundedAmount = roundMoney(
      refunds
        .filter(r => r.status === 'RECORDED')
        .reduce((s, r) => s + num(r.amount), 0),
    );

    return {
      summary: {
        refundableAmount,
        refundedAmount,
        remainingAmount: roundMoney(Math.max(0, refundableAmount - refundedAmount)),
        currency,
      },
      refunds: refunds.map(mapRefundRecord),
    };
  }

  async create(
    returnRequestId: string,
    tenantId: string,
    body: {
      amount: number;
      method: RefundMethod;
      note?: string;
      refundedAt: Date;
    },
  ): Promise<{ refund: RefundRecordDto; summary: RefundSummary }> {
    if (!REFUND_METHODS.includes(body.method)) {
      throw new Error('Geçersiz iade yöntemi.');
    }
    const amount = roundMoney(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Tutar 0\'dan büyük olmalıdır.');
    }

    const request = await loadRequestForRefund(returnRequestId, tenantId);
    if (!request) {
      throw new Error('Talep bulunamadı.');
    }

    assertRefundAllowed(request.type, request.status);

    const { amount: refundableAmount, currency } = await computeRefundableAmount(
      request.type,
      returnRequestId,
      tenantId,
    );

    const existing = await prisma.returnRefundRecord.findMany({
      where: { returnRequestId, tenantId, status: 'RECORDED' },
    });
    const refundedSoFar = roundMoney(existing.reduce((s, r) => s + num(r.amount), 0));
    const remaining = roundMoney(refundableAmount - refundedSoFar);

    if (amount > remaining + 0.001) {
      throw new Error(
        `İade tutarı kalan iade edilebilir tutarı (${remaining.toFixed(2)} ${currency}) aşamaz.`,
      );
    }

    const created = await prisma.returnRefundRecord.create({
      data: {
        tenantId,
        returnRequestId,
        orderId:    request.orderId,
        customerId: request.customerId,
        amount,
        currency,
        method:     body.method,
        note:       body.note?.trim() || null,
        refundedAt: body.refundedAt,
        status:     'RECORDED',
      },
    });

    const { summary } = await this.getSummary(returnRequestId, tenantId);
    void storeEmailService.notifyRefundRecorded(tenantId, created.id);
    return { refund: mapRefundRecord(created), summary };
  }

  async cancel(refundId: string, tenantId: string): Promise<{
    refund: RefundRecordDto;
    summary: RefundSummary;
  }> {
    const record = await prisma.returnRefundRecord.findFirst({
      where: { id: refundId, tenantId },
    });
    if (!record) {
      throw new Error('İade kaydı bulunamadı.');
    }
    if (record.status === 'CANCELLED') {
      throw new Error('İade kaydı zaten iptal edilmiş.');
    }

    const updated = await prisma.returnRefundRecord.update({
      where: { id: refundId },
      data:  { status: 'CANCELLED' },
    });

    const { summary } = await this.getSummary(record.returnRequestId, tenantId);
    return { refund: mapRefundRecord(updated), summary };
  }

  async getPublicRefundsForCustomer(
    returnRequestId: string,
    tenantId: string,
    customerId: string,
  ): Promise<CustomerRefundDto[]> {
    const request = await prisma.orderReturnRequest.findFirst({
      where: { id: returnRequestId, tenantId, customerId },
      select: { id: true },
    });
    if (!request) return [];

    try {
      const rows = await prisma.returnRefundRecord.findMany({
        where:   { returnRequestId, tenantId, status: 'RECORDED' },
        orderBy: { refundedAt: 'desc' },
        select: {
          amount: true,
          currency: true,
          refundedAt: true,
          method: true,
        },
      });

      return rows.map(r => ({
        amount:      num(r.amount),
        currency:    r.currency,
        refundedAt:  r.refundedAt,
        methodLabel: REFUND_METHOD_LABELS[r.method],
      }));
    } catch (error) {
      logger.warn({
        message: '[ReturnRefund] getPublicRefundsForCustomer skipped',
        returnRequestId,
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }
}

export const returnRefundService = new ReturnRefundService();
