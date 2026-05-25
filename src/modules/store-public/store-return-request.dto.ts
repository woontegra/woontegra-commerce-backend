import { z } from 'zod';

export const createReturnRequestSchema = z.object({
  type: z.enum(['CANCEL_REQUEST', 'RETURN_REQUEST']),
  reason: z.string().min(3).max(500),
  customerNote: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        quantity:    z.number().int().min(1),
        reason:      z.string().max(500).optional(),
      }),
    )
    .optional(),
});
