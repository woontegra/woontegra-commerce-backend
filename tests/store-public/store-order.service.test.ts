import { describe, expect, it } from 'vitest';
import { createStoreOrderSchema } from '../../src/modules/store-public/store-order.dto';

describe('createStoreOrderSchema', () => {
  it('accepts minimal valid payload', () => {
    const r = createStoreOrderSchema.safeParse({
      items: [{ productId: '550e8400-e29b-41d4-a716-446655440000', quantity: 1 }],
      customer: {
        firstName: 'Ali',
        lastName:  'Veli',
        email:     'ali@test.com',
        phone:     '05551234567',
      },
      shippingAddress: {
        fullName:    'Ali Veli',
        phone:       '05551234567',
        city:        'İstanbul',
        district:    'Kadıköy',
        addressLine: 'Test mah. No:1',
        postalCode:  '34000',
      },
      billingAddress: { sameAsShipping: true },
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty items', () => {
    const r = createStoreOrderSchema.safeParse({
      items: [],
      customer: {
        firstName: 'A',
        lastName:  'B',
        email:     'a@b.com',
        phone:     '05551234567',
      },
      shippingAddress: {
        fullName: 'A B',
        phone: '05551234567',
        city: 'İstanbul',
        district: 'Kadıköy',
        addressLine: 'Adres',
      },
      billingAddress: { sameAsShipping: true },
    });
    expect(r.success).toBe(false);
  });
});
