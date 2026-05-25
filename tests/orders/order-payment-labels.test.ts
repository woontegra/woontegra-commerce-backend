import { describe, expect, it } from 'vitest';
import {
  adminListPaymentProviderLabel,
  adminListPaymentStatusLabel,
} from '../../src/modules/orders/order-payment.util';
import { toAdminOrderListJson } from '../../src/modules/orders/order-admin.presenter';

describe('admin list payment labels', () => {
  it('maps provider and status labels for list UI', () => {
    expect(adminListPaymentProviderLabel('PAYTR')).toBe('Kredi Kartı / PayTR');
    expect(adminListPaymentProviderLabel('BANK_TRANSFER')).toBe('Havale / EFT');
    expect(adminListPaymentProviderLabel('CASH_ON_DELIVERY')).toBe('Kapıda Ödeme');
    expect(adminListPaymentProviderLabel(null)).toBe('Belirtilmemiş');
    expect(adminListPaymentStatusLabel('WAITING_BANK_TRANSFER')).toBe('Havale Bekleniyor');
    expect(adminListPaymentStatusLabel('PAID')).toBe('Ödendi');
    expect(adminListPaymentStatusLabel(null)).toBe('Belirsiz');
  });

  it('list JSON includes payment summary without secrets', () => {
    const rows = toAdminOrderListJson([
      {
        id: 'o1',
        orderNumber: 'ORD-1',
        status: 'PENDING',
        totalAmount: 100,
        shippingPrice: 0,
        discountAmount: 0,
        campaignDiscount: 0,
        currency: 'TRY',
        notes: '[Ödeme yöntemi: PAYTR]',
        paymentProvider: 'PAYTR',
        paymentStatus: 'PAID',
        createdAt: new Date(),
        updatedAt: new Date(),
        customer: { firstName: 'A', lastName: 'B', email: 'a@t.com' },
        items: [],
        paymentSessions: [],
      },
    ]);
    expect(rows[0].payment?.providerLabel).toBe('Kredi Kartı / PayTR');
    expect(rows[0].payment?.statusLabel).toBe('Ödendi');
    expect(rows[0].paymentProvider).toBe('PAYTR');
    expect(JSON.stringify(rows[0])).not.toMatch(/merchant|iban|apiKey/i);
  });
});
