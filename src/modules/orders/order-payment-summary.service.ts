import type { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import {
  mergePaymentSummaryGroups,
  orderSummarySinceDate,
  type PaymentSummary,
} from './order-payment-summary.util';

/**
 * Tenant siparişleri — ödeme yöntemi / durumu sayıları (dashboard).
 * @param days Son N gün (dashboard overview ile aynı); verilmezse tüm siparişler.
 */
export async function getOrderPaymentSummary(
  tenantId: string,
  days?: number,
): Promise<PaymentSummary> {
  const where: Prisma.OrderWhereInput = { tenantId };

  if (days != null && days > 0) {
    where.createdAt = { gte: orderSummarySinceDate(days) };
  }

  const [providerRows, statusRows] = await Promise.all([
    prisma.order.groupBy({
      by:    ['paymentProvider'],
      where,
      _count: { _all: true },
    }),
    prisma.order.groupBy({
      by:    ['paymentStatus'],
      where,
      _count: { _all: true },
    }),
  ]);

  return mergePaymentSummaryGroups(providerRows, statusRows);
}
