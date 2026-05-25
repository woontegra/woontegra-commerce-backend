import type { Prisma } from '@prisma/client';
import type { OrderListQuery } from './order-list.query';

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

  return where;
}
