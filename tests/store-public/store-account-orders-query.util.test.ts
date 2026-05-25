import { describe, expect, it } from 'vitest';
import {
  STORE_ACCOUNT_DEFAULT_LIMIT,
  STORE_ACCOUNT_DEFAULT_PAGE,
  STORE_ACCOUNT_MAX_LIMIT,
  buildPaginationMeta,
  buildStoreAccountOrdersWhere,
  parseStoreAccountOrdersListQuery,
} from '../../src/modules/store-public/store-account-orders-query.util';

describe('store-account-orders-query.util', () => {
  it('parses valid status filter', () => {
    const r = parseStoreAccountOrdersListQuery({ status: 'SHIPPED' });
    expect(r.invalid).toBe(false);
    expect(r.query.status).toBe('SHIPPED');
    expect(r.query.filter).toBeUndefined();
  });

  it('parses WAITING_PAYMENT filter', () => {
    const r = parseStoreAccountOrdersListQuery({ filter: 'WAITING_PAYMENT' });
    expect(r.invalid).toBe(false);
    expect(r.query.filter).toBe('WAITING_PAYMENT');
  });

  it('rejects invalid status and filter together', () => {
    const r = parseStoreAccountOrdersListQuery({
      status: 'SHIPPED',
      filter: 'WAITING_PAYMENT',
    });
    expect(r.invalid).toBe(true);
  });

  it('marks unknown status as invalid', () => {
    const r = parseStoreAccountOrdersListQuery({ status: 'NOT_A_STATUS' });
    expect(r.invalid).toBe(true);
    expect(r.query.status).toBeUndefined();
  });

  it('builds tenant-scoped SHIPPED where', () => {
    const where = buildStoreAccountOrdersWhere('t1', 'c1', {
      status: 'SHIPPED',
      page: STORE_ACCOUNT_DEFAULT_PAGE,
      limit: STORE_ACCOUNT_DEFAULT_LIMIT,
    });
    expect(where).toEqual({ tenantId: 't1', customerId: 'c1', status: 'SHIPPED' });
  });

  it('builds WAITING_PAYMENT OR clause', () => {
    const where = buildStoreAccountOrdersWhere('t1', 'c1', {
      filter: 'WAITING_PAYMENT',
      page: STORE_ACCOUNT_DEFAULT_PAGE,
      limit: STORE_ACCOUNT_DEFAULT_LIMIT,
    });
    expect(where.tenantId).toBe('t1');
    expect(where.customerId).toBe('c1');
    expect(where.OR).toEqual([
      { paymentStatus: { in: ['PENDING', 'WAITING_BANK_TRANSFER'] } },
      { status: 'PENDING' },
    ]);
  });

  it('defaults page and limit', () => {
    const r = parseStoreAccountOrdersListQuery({});
    expect(r.invalid).toBe(false);
    expect(r.query.page).toBe(STORE_ACCOUNT_DEFAULT_PAGE);
    expect(r.query.limit).toBe(STORE_ACCOUNT_DEFAULT_LIMIT);
  });

  it('parses page and limit', () => {
    const r = parseStoreAccountOrdersListQuery({ page: '2', limit: '20' });
    expect(r.invalid).toBe(false);
    expect(r.query.page).toBe(2);
    expect(r.query.limit).toBe(20);
  });

  it('accepts limit=5 for recent orders overview', () => {
    const r = parseStoreAccountOrdersListQuery({ page: '1', limit: '5' });
    expect(r.invalid).toBe(false);
    expect(r.query.page).toBe(1);
    expect(r.query.limit).toBe(5);
  });

  it('falls back on invalid page without marking filter invalid', () => {
    const r = parseStoreAccountOrdersListQuery({ page: '0', limit: '10', status: 'SHIPPED' });
    expect(r.invalid).toBe(false);
    expect(r.query.page).toBe(STORE_ACCOUNT_DEFAULT_PAGE);
    expect(r.query.status).toBe('SHIPPED');
  });

  it('caps limit at max', () => {
    const r = parseStoreAccountOrdersListQuery({ limit: '999' });
    expect(r.invalid).toBe(false);
    expect(r.query.limit).toBe(STORE_ACCOUNT_MAX_LIMIT);
  });

  it('buildPaginationMeta for empty total', () => {
    expect(buildPaginationMeta(0, 1, 10)).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    });
  });

  it('buildPaginationMeta middle page', () => {
    expect(buildPaginationMeta(37, 2, 10)).toEqual({
      page: 2,
      limit: 10,
      total: 37,
      totalPages: 4,
      hasNextPage: true,
      hasPrevPage: true,
    });
  });

  it('combines SHIPPED filter with pagination params', () => {
    const r = parseStoreAccountOrdersListQuery({ status: 'SHIPPED', page: '2', limit: '10' });
    expect(r.invalid).toBe(false);
    expect(r.query.status).toBe('SHIPPED');
    expect(r.query.page).toBe(2);
    expect(r.query.limit).toBe(10);
  });
});
