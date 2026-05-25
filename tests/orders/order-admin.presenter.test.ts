import { describe, it, expect } from 'vitest';
import { buildAdminOrderMeta } from '../../src/modules/orders/order-admin.presenter';

describe('order-admin.presenter', () => {
  const baseOrder = {
    id:               'ord-1',
    orderNumber:      'ORD-1',
    status:           'PENDING' as const,
    totalAmount:      553.9,
    shippingPrice:    79.9,
    discountAmount:   0,
    campaignDiscount: 0,
    currency:         'TRY',
    createdAt:        new Date(),
    updatedAt:        new Date(),
    customer: {
      firstName: 'Ali',
      lastName:  'Veli',
      email:     'ali@test.com',
      phone:     '555',
    },
    items: [{
      id:             'item-1',
      quantity:       1,
      price:          449,
      discountAmount: 0,
      product:        { id: 'p1', name: 'T-Shirt', slug: 't' },
      variant:        null,
    }],
    paymentSessions: [],
  };

  it('parses storefront payment and addresses from notes', () => {
    const notes = [
      '[Ödeme yöntemi: BANK_TRANSFER]',
      '[Kargo: Standart Kargo — 79.90 ₺]',
      '[Vitrin siparişi — ödeme bekleniyor]',
      'Teslimat:',
      'Ali Veli · 555',
      'Atatürk Cad. No:1',
      'Kadıköy / İstanbul 34000',
    ].join('\n\n');

    const meta = buildAdminOrderMeta({ ...baseOrder, notes });

    expect(meta.isStorefrontOrder).toBe(true);
    expect(meta.payment.provider).toBe('BANK_TRANSFER');
    expect(meta.payment.methodLabel).toBe('Havale / EFT');
    expect(meta.totals.shippingPrice).toBe(79.9);
    expect(meta.shippingAddress?.city).toBe('İstanbul');
    expect(meta.billingAddress?.sameAsShipping).toBe(true);
  });

  it('parses cash on delivery fee', () => {
    const notes = [
      '[Ödeme yöntemi: CASH_ON_DELIVERY]',
      '[Kapıda ödeme ek ücreti: 25.00 ₺]',
      '[Kargo: Standart — 0.00 ₺ (ücretsiz kargo)]',
    ].join('\n');

    const meta = buildAdminOrderMeta({
      ...baseOrder,
      notes,
      totalAmount: 474,
      shippingPrice: 0,
    });

    expect(meta.totals.cashOnDeliveryFee).toBe(25);
  });
});
