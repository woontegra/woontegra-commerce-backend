import type { OrderStatus, Prisma } from '@prisma/client';

export const STORE_ACCOUNT_ORDER_STATUSES = [
  'PENDING',
  'PROCESSING',
  'PAID',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const satisfies readonly OrderStatus[];

export const STORE_ACCOUNT_ORDER_FILTERS = ['WAITING_PAYMENT'] as const;

export type StoreAccountOrderFilter = typeof STORE_ACCOUNT_ORDER_FILTERS[number];

export const STORE_ACCOUNT_DEFAULT_PAGE = 1;
export const STORE_ACCOUNT_DEFAULT_LIMIT = 10;
export const STORE_ACCOUNT_MAX_LIMIT = 50;

export type StoreAccountOrdersListQuery = {
  status?: OrderStatus;
  filter?: StoreAccountOrderFilter;
  page:  number;
  limit: number;
};

export type StoreAccountOrdersPaginationMeta = {
  page:        number;
  limit:       number;
  total:       number;
  totalPages:  number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  max?: number,
): { value: number; invalid: boolean } {
  if (raw == null || raw === '') return { value: fallback, invalid: false };
  const trimmed = raw.trim();
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 1 || String(n) !== trimmed) {
    return { value: fallback, invalid: true };
  }
  const value = max != null ? Math.min(n, max) : n;
  if (max != null && n > max) return { value, invalid: true };
  return { value, invalid: false };
}

export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number,
): StoreAccountOrdersPaginationMeta {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: totalPages > 0 && page < totalPages,
    hasPrevPage: page > 1 && totalPages > 0,
  };
}

export function isValidStoreAccountOrderStatus(v: string): v is OrderStatus {
  return (STORE_ACCOUNT_ORDER_STATUSES as readonly string[]).includes(v);
}

export function isValidStoreAccountOrderFilter(v: string): v is StoreAccountOrderFilter {
  return (STORE_ACCOUNT_ORDER_FILTERS as readonly string[]).includes(v);
}

export function parseStoreAccountOrdersListQuery(input: {
  status?: string;
  filter?: string;
  page?:   string;
  limit?:  string;
}): { query: StoreAccountOrdersListQuery; invalid: boolean } {
  let invalid = false;

  const pageParsed = parsePositiveInt(input.page, STORE_ACCOUNT_DEFAULT_PAGE);
  const limitParsed = parsePositiveInt(
    input.limit,
    STORE_ACCOUNT_DEFAULT_LIMIT,
    STORE_ACCOUNT_MAX_LIMIT,
  );
  const query: StoreAccountOrdersListQuery = {
    page:  pageParsed.value,
    limit: limitParsed.value,
  };

  const filterRaw = input.filter?.trim();
  const statusRaw = input.status?.trim();

  if (filterRaw) {
    if (isValidStoreAccountOrderFilter(filterRaw)) {
      query.filter = filterRaw;
    } else {
      invalid = true;
    }
  }

  if (statusRaw && !query.filter) {
    if (isValidStoreAccountOrderStatus(statusRaw)) {
      query.status = statusRaw;
    } else {
      invalid = true;
    }
  } else if (statusRaw && query.filter) {
    invalid = true;
  }

  return { query, invalid };
}

export function buildStoreAccountOrdersWhere(
  tenantId: string,
  customerId: string,
  listQuery: StoreAccountOrdersListQuery = {},
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { tenantId, customerId };

  if (listQuery.filter === 'WAITING_PAYMENT') {
    where.OR = [
      { paymentStatus: { in: ['PENDING', 'WAITING_BANK_TRANSFER'] } },
      { status: 'PENDING' },
    ];
    return where;
  }

  if (listQuery.status) {
    where.status = listQuery.status;
  }

  return where;
}
