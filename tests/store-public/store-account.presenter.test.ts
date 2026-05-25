import { describe, expect, it } from 'vitest';
import {
  buildCustomerBankTransferPayment,
  buildCustomerOrderPayment,
  buildCustomerPaymentHint,
  pickCustomerReturnRequestPublic,
  pickCustomerShippingFields,
  shouldShowCustomerBankTransferPayment,
} from '../../src/modules/store-public/store-account.presenter';

describe('pickCustomerReturnRequestPublic', () => {
  it('strips admin and internal fields', () => {
    const created = new Date('2026-05-25T10:00:00.000Z');
    const result = pickCustomerReturnRequestPublic({
      id: 'req-1',
      requestNumber: 'RTN-1',
      type: 'RETURN_REQUEST',
      status: 'PENDING',
      reason: 'Test',
      customerNote: 'not',
      createdAt: created,
      updatedAt: created,
      items: [{ id: 'i1', orderItemId: 'oi1', quantity: 1, reason: null, productName: 'Ürün' }],
      order: {
        id: 'o1',
        orderNumber: 'ORD-1',
        status: 'DELIVERED',
        totalAmount: 199.5,
        currency: 'TRY',
      },
    } as never);

    expect(result).toMatchObject({
      requestNumber: 'RTN-1',
      type: 'RETURN_REQUEST',
      status: 'PENDING',
      order: {
        orderNumber: 'ORD-1',
        status: 'DELIVERED',
        totalAmount: 199.5,
        currency: 'TRY',
      },
    });
    expect(result).not.toHaveProperty('adminNote');
    expect(result).not.toHaveProperty('stockRestoredAt');
    expect(result).not.toHaveProperty('tenantId');
    expect(result).not.toHaveProperty('customerId');
  });
});

describe('pickCustomerShippingFields', () => {
  it('returns public shipping fields for customer API', () => {
    const shipped = new Date('2026-05-25T11:30:00.000Z');
    const result = pickCustomerShippingFields({
      shippingCarrier:        'Yurtiçi Kargo',
      shippingTrackingNumber: 'ABC123',
      shippingTrackingUrl:    'https://kargo.example/t/ABC123',
      shippedAt:              shipped,
      shippingNotificationSentAt: new Date(),
    });

    expect(result).toEqual({
      shippingCarrier:        'Yurtiçi Kargo',
      shippingTrackingNumber: 'ABC123',
      shippingTrackingUrl:    'https://kargo.example/t/ABC123',
      shippedAt:              shipped.toISOString(),
    });
    expect(result).not.toHaveProperty('shippingNotificationSentAt');
  });

  it('returns nulls when shipping not set', () => {
    expect(pickCustomerShippingFields({})).toEqual({
      shippingCarrier:        null,
      shippingTrackingNumber: null,
      shippingTrackingUrl:    null,
      shippedAt:              null,
    });
  });
});

describe('buildCustomerOrderPayment', () => {
  const approved = new Date('2026-05-25T11:30:00.000Z');

  it('returns PayTR paid labels and safe fields only', () => {
    const result = buildCustomerOrderPayment({
      paymentProvider: 'PAYTR',
      paymentStatus: 'PAID',
      paymentApprovedAt: approved,
      paymentReceivedEmailSentAt: new Date(),
      paymentFailedEmailSentAt: new Date(),
    });

    expect(result).toMatchObject({
      provider: 'PAYTR',
      providerLabel: 'Kredi Kartı / PayTR',
      status: 'PAID',
      statusLabel: 'Ödendi',
      approvedAt: approved.toISOString(),
      failedAt: null,
      hint: 'Ödemeniz başarıyla alınmıştır.',
      methodLabel: 'Kredi Kartı / PayTR',
    });
    expect(result).not.toHaveProperty('paymentReceivedEmailSentAt');
    expect(result).not.toHaveProperty('paymentFailedEmailSentAt');
    expect(result).not.toHaveProperty('bankTransferPendingEmailSentAt');
    expect(result).not.toHaveProperty('sessionStatus');
    expect(result).not.toHaveProperty('merchantId');
  });

  it('returns bank transfer waiting labels', () => {
    const result = buildCustomerOrderPayment({
      paymentProvider: 'BANK_TRANSFER',
      paymentStatus: 'WAITING_BANK_TRANSFER',
    });
    expect(result.providerLabel).toBe('Havale / EFT');
    expect(result.statusLabel).toBe('Havale Bekleniyor');
    expect(result.hint).toContain('Havale/EFT ödemeniz bekleniyor');
  });

  it('returns cash on delivery hint', () => {
    const result = buildCustomerOrderPayment({
      paymentProvider: 'CASH_ON_DELIVERY',
      paymentStatus: 'PENDING',
    });
    expect(result.providerLabel).toBe('Kapıda Ödeme');
    expect(result.hint).toBe('Ödemenizi teslimat sırasında yapabilirsiniz.');
  });

  it('handles missing provider via hint', () => {
    expect(buildCustomerPaymentHint(null, 'PENDING')).toBe(
      'Ödeme yöntemi bilgisi bulunamadı.',
    );
  });
});

describe('shouldShowCustomerBankTransferPayment', () => {
  it('shows for BANK_TRANSFER + WAITING_BANK_TRANSFER', () => {
    expect(shouldShowCustomerBankTransferPayment({
      paymentProvider: 'BANK_TRANSFER',
      paymentStatus: 'WAITING_BANK_TRANSFER',
      status: 'PENDING',
    })).toBe(true);
  });

  it('shows for BANK_TRANSFER + PENDING payment status', () => {
    expect(shouldShowCustomerBankTransferPayment({
      paymentProvider: 'BANK_TRANSFER',
      paymentStatus: 'PENDING',
      status: 'PROCESSING',
    })).toBe(true);
  });

  it('hides for BANK_TRANSFER + PAID', () => {
    expect(shouldShowCustomerBankTransferPayment({
      paymentProvider: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      status: 'PROCESSING',
    })).toBe(false);
  });

  it('hides for BANK_TRANSFER + APPROVED', () => {
    expect(shouldShowCustomerBankTransferPayment({
      paymentProvider: 'BANK_TRANSFER',
      paymentStatus: 'APPROVED',
      status: 'PROCESSING',
    })).toBe(false);
  });

  it('hides for cancelled order', () => {
    expect(shouldShowCustomerBankTransferPayment({
      paymentProvider: 'BANK_TRANSFER',
      paymentStatus: 'WAITING_BANK_TRANSFER',
      status: 'CANCELLED',
    })).toBe(false);
  });

  it('hides for PAYTR', () => {
    expect(shouldShowCustomerBankTransferPayment({
      paymentProvider: 'PAYTR',
      paymentStatus: 'PAID',
      status: 'PROCESSING',
    })).toBe(false);
  });

  it('hides for CASH_ON_DELIVERY', () => {
    expect(shouldShowCustomerBankTransferPayment({
      paymentProvider: 'CASH_ON_DELIVERY',
      paymentStatus: 'PENDING',
      status: 'PROCESSING',
    })).toBe(false);
  });
});

describe('buildCustomerBankTransferPayment', () => {
  it('returns safe bank fields with paymentReference', () => {
    const result = buildCustomerBankTransferPayment('ORD-100', {
      bankName: 'Ziraat',
      accountHolder: 'Mağaza A.Ş.',
      iban: 'TR330006100519786457841326',
      description: 'Sipariş no yazınız',
    });
    expect(result).toEqual({
      bankName: 'Ziraat',
      accountHolder: 'Mağaza A.Ş.',
      iban: 'TR330006100519786457841326',
      description: 'Sipariş no yazınız',
      paymentReference: 'ORD-100',
    });
    expect(result).not.toHaveProperty('credentialsEncrypted');
    expect(result).not.toHaveProperty('publicConfigJson');
  });

  it('returns null when tenant details incomplete', () => {
    expect(buildCustomerBankTransferPayment('ORD-1', null)).toBeNull();
    expect(buildCustomerBankTransferPayment('ORD-1', {
      bankName: '',
      accountHolder: 'X',
      iban: '',
      description: '',
    })).toBeNull();
  });
});
