import { z } from 'zod';
import type { OrderPaymentStatus, OrderStatus, PaymentProviderType } from '@prisma/client';
import { PAYMENT_PROVIDER_TYPES } from '../payments/payment-provider.types';

const ORDER_STATUSES = [
  'PENDING',
  'PROCESSING',
  'PAID',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const satisfies readonly OrderStatus[];

const PAYMENT_STATUSES = [
  'PENDING',
  'WAITING_BANK_TRANSFER',
  'PAID',
  'APPROVED',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly OrderPaymentStatus[];

const ORDER_SOURCES = ['all', 'storefront', 'trendyol'] as const;

export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  search: z.string().max(200).optional(),
  paymentProvider: z.enum(PAYMENT_PROVIDER_TYPES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  source: z.enum(ORDER_SOURCES).optional(),
});

export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export function parseOrderListQuery(
  input: Record<string, unknown>,
): { ok: true; data: OrderListQuery } | { ok: false; error: string } {
  const parsed = orderListQuerySchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, error: msg };
  }
  return { ok: true, data: parsed.data };
}
