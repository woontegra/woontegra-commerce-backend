import { z } from 'zod';

export const updateOrderShippingSchema = z.object({
  shippingCarrier:        z.string().max(200).optional().nullable(),
  shippingTrackingNumber: z.string().max(200).optional().nullable(),
  shippingTrackingUrl:    z.string().max(2048).optional().nullable(),
  markAsShipped:          z.boolean().optional(),
});

export type UpdateOrderShippingDto = z.infer<typeof updateOrderShippingSchema>;
