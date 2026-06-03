import { z } from 'zod';

const paymentProviderEnum = z.enum([
  'PAYTR',
  'IYZICO',
  'BANK_TRANSFER',
  'CASH_ON_DELIVERY',
]);

export const storeAddressBlockSchema = z.object({
  fullName:    z.string().min(2).max(200),
  phone:       z.string().min(7).max(30),
  city:        z.string().min(1).max(100),
  district:    z.string().min(1).max(100),
  addressLine: z.string().min(5).max(500),
  postalCode:  z.string().max(20).optional().default(''),
});

export type StoreAddressBlock = z.output<typeof storeAddressBlockSchema>;

export const createStoreOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId:  z.string().uuid(),
        variantId:  z.string().uuid().nullable().optional(),
        quantity:   z.number().int().min(1).max(999),
      }),
    )
    .min(1),
  customer: z.object({
    firstName: z.string().min(1).max(100),
    lastName:  z.string().min(1).max(100),
    email:     z.string().email().max(200),
    phone:     z.string().min(7).max(30),
  }),
  shippingAddress: storeAddressBlockSchema,
  billingAddress: z.object({
    sameAsShipping: z.boolean().default(true),
    type:           z.enum(['individual', 'corporate']).optional(),
    fullName:       z.string().optional(),
    phone:          z.string().optional(),
    city:           z.string().optional(),
    district:       z.string().optional(),
    addressLine:    z.string().optional(),
    postalCode:     z.string().optional(),
    taxOffice:      z.string().optional(),
    taxNumber:      z.string().optional(),
    companyName:    z.string().optional(),
  }),
  notes: z.string().max(2000).optional().default(''),
  paymentProvider: paymentProviderEnum.optional(),
  consents: z.object({
    kvkkConsent:      z.boolean(),
    marketingConsent: z.boolean().default(false),
  }).optional(),
});

/** Parse sonrası çıktı tipi (varsayılanlar uygulanmış, zorunlu alanlar dolu). */
export type CreateStoreOrderInput = z.output<typeof createStoreOrderSchema>;
