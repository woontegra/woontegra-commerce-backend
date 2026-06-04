import type { Prisma } from '@prisma/client';
import type { OrderListQuery } from './order-list.query';
import { OPERATION_FILTERS } from './order-list.query';

type OperationFilter = (typeof OPERATION_FILTERS)[number];

function buildOperationFilterClause(
  operationFilter: OperationFilter,
): Prisma.OrderWhereInput {
  if (operationFilter === 'invoice_missing') {
    return {
      AND: [
        { OR: [{ invoiceNumber: null }, { invoiceNumber: '' }] },
        { OR: [{ invoiceUrl: null }, { invoiceUrl: '' }] },
      ],
    };
  }
  return {
    AND: [
      { OR: [{ shippingTrackingNumber: null }, { shippingTrackingNumber: '' }] },
      { OR: [{ shippingTrackingUrl: null }, { shippingTrackingUrl: '' }] },
    ],
  };
}

export function buildOrderListWhere(
  tenantId: string,
  query: OrderListQuery,
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { tenantId };

  if (query.status) {
    where.status = query.status;
  }

  if (query.paymentProvider) {
    where.paymentProvider = query.paymentProvider;
  }

  if (query.paymentStatus) {
    where.paymentStatus = query.paymentStatus;
  }

  if (query.search?.trim()) {
    const search = query.search.trim();
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      {
        customer: {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName:  { contains: search, mode: 'insensitive' } },
            { email:     { contains: search, mode: 'insensitive' } },
          ],
        },
      },
    ];
  }

  if (query.operationFilter) {
    return { AND: [where, buildOperationFilterClause(query.operationFilter)] };
  }

  return where;
}
