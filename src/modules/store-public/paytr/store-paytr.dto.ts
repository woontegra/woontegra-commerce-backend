import { z } from 'zod';

export const startPaytrPaymentSchema = z
  .object({
    orderId:     z.string().uuid().optional(),
    orderNumber: z.string().min(1).max(100).optional(),
  })
  .refine(d => !!(d.orderId || d.orderNumber), {
    message: 'orderId veya orderNumber gerekli.',
  });

export type StartPaytrPaymentInput = z.infer<typeof startPaytrPaymentSchema>;
