import type { Prisma } from '@prisma/client';
import type { OrderStatus } from '@prisma/client';
import { trendyolStatusesForFilter } from './order-unified.presenter';

export type TrendyolOrderListQuery = {
  status?:  OrderStatus;
  search?:  string;
};

/** Trendyol için uygulanamaz filtre — hiç kayıt dönmez. */
const IMPOSSIBLE_TRENDYOL_WHERE = { id: { in: [] as string[] } } as const;

export function buildTrendyolOrderListWhere(
  tenantId: string,
  query: TrendyolOrderListQuery,
): Prisma.TrendyolOrderWhereInput {
  const where: Prisma.TrendyolOrderWhereInput = { tenantId };

  if (query.status) {
    const statuses = trendyolStatusesForFilter(query.status);
    if (statuses.length === 0) {
      return { tenantId, ...IMPOSSIBLE_TRENDYOL_WHERE };
    }
    where.status = { in: statuses };
  }

  if (query.search?.trim()) {
    const search = query.search.trim();
    where.OR = [
      { orderNumber:       { contains: search, mode: 'insensitive' } },
      { customerFirstName: { contains: search, mode: 'insensitive' } },
      { customerLastName:  { contains: search, mode: 'insensitive' } },
      { customerEmail:     { contains: search, mode: 'insensitive' } },
    ];
  }

  return where;
}
