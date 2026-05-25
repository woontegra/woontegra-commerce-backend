import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderEmailTemplate } from '../../src/modules/email/templates';
import {
  orderStatusLabel,
  paymentMethodLabel,
  returnStatusLabel,
  returnTypeLabel,
  shouldNotifyCustomerOrderStatus,
  shouldSendBankTransferPaymentApproved,
  shouldSendCustomerStatusEmail,
  shouldSendPaytrPaymentFailedNotification,
  storefrontUrl,
} from '../../src/modules/email/templates/store-email.util';

const branding = {
  storeName:  'Demo Mağaza',
  logoUrl:    null as string | null,
  tenantSlug: 'demo',
};

describe('store email templates', () => {
  it('STORE_ORDER_CREATED renders Turkish subject and totals', () => {
    const rendered = renderEmailTemplate('STORE_ORDER_CREATED', {
      ...branding,
      customerName:   'Ali Veli',
      orderNumber:    'ORD-1001',
      itemsSubtotal:  250,
      shippingTotal:  29.9,
      grandTotal:     279.9,
      currency:       'TRY',
      paymentMethod:  'Kapıda Ödeme',
      orderDetailUrl: storefrontUrl('demo', '/store/hesabim/siparisler/ORD-1001'),
      storefrontUrl:  storefrontUrl('demo', '/store'),
    });

    expect(rendered.subject).toContain('ORD-1001');
    expect(rendered.html).toContain('Siparişiniz alındı');
    expect(rendered.html).toContain('250.00');
    expect(rendered.html).toContain('Kapıda Ödeme');
    expect(rendered.html).toContain('tenant=demo');
  });

  it('STORE_ORDER_STATUS_CHANGED shows old and new status labels', () => {
    const rendered = renderEmailTemplate('STORE_ORDER_STATUS_CHANGED', {
      ...branding,
      customerName:   'Ali Veli',
      orderNumber:    'ORD-1001',
      oldStatus:      'PENDING',
      newStatus:      'SHIPPED',
      orderDetailUrl: storefrontUrl('demo', '/store/hesabim/siparisler/ORD-1001'),
    });

    expect(rendered.subject).toContain('güncellendi');
    expect(rendered.html).toContain(orderStatusLabel('PENDING'));
    expect(rendered.html).toContain(orderStatusLabel('SHIPPED'));
  });

  it('STORE_RETURN_REQUEST_CREATED shows inceleniyor status', () => {
    const rendered = renderEmailTemplate('STORE_RETURN_REQUEST_CREATED', {
      ...branding,
      customerName:     'Ali Veli',
      requestNumber:    'RTN-ABC',
      orderNumber:      'ORD-1001',
      requestType:      'RETURN_REQUEST',
      statusLabel:      returnStatusLabel('PENDING'),
      requestDetailUrl: storefrontUrl('demo', '/store/hesabim/iade-taleplerim/req-1'),
    });

    expect(rendered.html).toContain('RTN-ABC');
    expect(rendered.html).toContain(returnTypeLabel('RETURN_REQUEST'));
    expect(rendered.html).toContain('İnceleniyor');
  });

  it('STORE_RETURN_COMPLETED avoids guaranteed refund wording', () => {
    const rendered = renderEmailTemplate('STORE_RETURN_COMPLETED', {
      ...branding,
      customerName:     'Ali Veli',
      requestNumber:    'RTN-ABC',
      orderNumber:      'ORD-1001',
      requestDetailUrl: storefrontUrl('demo', '/store/hesabim/iade-taleplerim/req-1'),
    });

    expect(rendered.html).toContain('ayrıca işlenecektir');
    expect(rendered.html).not.toMatch(/para iadesi yapıldı/i);
    expect(rendered.html).not.toMatch(/banka provizyonu/i);
  });

  it('STORE_REFUND_RECORDED uses cautious refund wording', () => {
    const rendered = renderEmailTemplate('STORE_REFUND_RECORDED', {
      ...branding,
      customerName:     'Ali Veli',
      requestNumber:    'RTN-ABC',
      orderNumber:      'ORD-1001',
      amount:           150,
      currency:         'TRY',
      methodLabel:      'Banka havalesi',
      refundedAt:       '25 Mayıs 2026',
      requestDetailUrl: storefrontUrl('demo', '/store/hesabim/iade-taleplerim/req-1'),
    });

    expect(rendered.html).toContain('kaydı oluşturuldu');
    expect(rendered.html).toContain('150.00');
    expect(rendered.html).not.toMatch(/otomatik banka provizyonu/i);
  });
});

describe('STORE_ORDER_CASH_ON_DELIVERY_CREATED template', () => {
  it('renders Turkish COD subject with order total and payment method', () => {
    const rendered = renderEmailTemplate('STORE_ORDER_CASH_ON_DELIVERY_CREATED', {
      ...branding,
      customerName:      'Ali Veli',
      orderNumber:       'ORD-COD-1',
      orderDate:         '25 Mayıs 2026 14:30',
      paymentMethod:     'Kapıda Ödeme',
      itemsSubtotal:     200,
      shippingTotal:     29.9,
      cashOnDeliveryFee: 15,
      grandTotal:        244.9,
      currency:          'TRY',
      orderDetailUrl:    storefrontUrl('demo', '/store/hesabim/siparisler/ORD-COD-1'),
      storefrontUrl:     storefrontUrl('demo', '/store'),
    });

    expect(rendered.subject).toContain('Kapıda ödeme');
    expect(rendered.subject).toContain('ORD-COD-1');
    expect(rendered.html).toContain('Siparişiniz alındı');
    expect(rendered.html).toContain('teslimatı sırasında');
    expect(rendered.html).toContain('Kapıda Ödeme');
    expect(rendered.html).toContain('244.90');
    expect(rendered.html).toContain('Kapıda ödeme ek ücreti');
    expect(rendered.html).toContain('15.00');
    expect(rendered.html).not.toContain('tenantId');
    expect(rendered.html).not.toMatch(/iban/i);
    expect(rendered.html).not.toMatch(/paytr/i);
  });

  it('shows inclusive fee note when COD extra fee is zero', () => {
    const rendered = renderEmailTemplate('STORE_ORDER_CASH_ON_DELIVERY_CREATED', {
      ...branding,
      customerName:      'Ali',
      orderNumber:       'ORD-COD-2',
      orderDate:         '26 Mayıs 2026',
      paymentMethod:     'Kapıda Ödeme',
      itemsSubtotal:     100,
      shippingTotal:     0,
      cashOnDeliveryFee: 0,
      grandTotal:        100,
      currency:          'TRY',
      orderDetailUrl:    storefrontUrl('demo', '/store/hesabim/siparisler/ORD-COD-2'),
      storefrontUrl:     storefrontUrl('demo', '/store'),
    });

    expect(rendered.html).toContain('genel toplam tutara dahildir');
    expect(rendered.html).not.toContain('Kapıda ödeme ek ücreti</span>');
  });
});

describe('STORE_ORDER_BANK_TRANSFER_APPROVED template', () => {
  it('renders Turkish approval subject without sensitive fields', () => {
    const rendered = renderEmailTemplate('STORE_ORDER_BANK_TRANSFER_APPROVED', {
      storeName:  'Demo Mağaza',
      logoUrl:    null,
      tenantSlug: 'demo',
      customerName:   'Ali Veli',
      orderNumber:    'ORD-APP-1',
      orderDate:      '25 Mayıs 2026 14:30',
      paymentMethod:  'Havale / EFT',
      grandTotal:     420,
      currency:       'TRY',
      orderDetailUrl: storefrontUrl('demo', '/store/hesabim/siparisler/ORD-APP-1'),
      storefrontUrl:  storefrontUrl('demo', '/store'),
    });

    expect(rendered.subject).toBe('Ödemeniz onaylandı - #ORD-APP-1');
    expect(rendered.html).toContain('onaylandı');
    expect(rendered.html).toContain('hazırlık sürecine');
    expect(rendered.html).toContain('420.00');
    expect(rendered.html).toContain('Havale / EFT');
    expect(rendered.html).not.toMatch(/credentialsEncrypted|merchant_key|tenantId/i);
  });
});

describe('STORE_ORDER_BANK_TRANSFER_PENDING template', () => {
  it('renders Turkish subject with bank details and order reference hint', () => {
    const rendered = renderEmailTemplate('STORE_ORDER_BANK_TRANSFER_PENDING', {
      storeName:  'Demo Mağaza',
      logoUrl:    null,
      tenantSlug: 'demo',
      customerName:   'Ali Veli',
      orderNumber:    'ORD-BT-1',
      orderDate:      '25 Mayıs 2026 14:30',
      paymentMethod:  'Havale / EFT',
      grandTotal:     350,
      currency:       'TRY',
      bankName:       'Ziraat Bankası',
      accountHolder:  'Demo Mağaza Ltd.',
      iban:           'TR33 0006 1005 1978 6457 8413 26',
      paymentNote:    'Şube kodu 1234',
      orderDetailUrl: storefrontUrl('demo', '/store/hesabim/siparisler/ORD-BT-1'),
      ordersListUrl:  storefrontUrl('demo', '/store/hesabim/siparisler'),
      storefrontUrl:  storefrontUrl('demo', '/store'),
    });

    expect(rendered.subject).toBe('Havale/EFT ödeme bilgileriniz - #ORD-BT-1');
    expect(rendered.html).toContain('Ödeme bekleniyor');
    expect(rendered.html).toContain('ORD-BT-1');
    expect(rendered.html).toContain('350.00');
    expect(rendered.html).toContain('Ziraat Bankası');
    expect(rendered.html).toContain('Demo Mağaza Ltd.');
    expect(rendered.html).toContain('TR330006100519786457841326');
    expect(rendered.html).toContain('açıklama alanına sipariş numaranızı');
    expect(rendered.html).not.toMatch(/credentialsEncrypted|merchant_key|tenantId/i);
  });
});

describe('STORE_ORDER_PAYMENT_FAILED template', () => {
  it('renders Turkish subject and order details without PayTR secrets', () => {
    const rendered = renderEmailTemplate('STORE_ORDER_PAYMENT_FAILED', {
      storeName:  'Demo Mağaza',
      logoUrl:    null,
      tenantSlug: 'demo',
      customerName:   'Ali Veli',
      orderNumber:    'ORD-FAIL-1',
      orderDate:      '25 Mayıs 2026 14:30',
      paymentMethod:  'Kredi Kartı (PayTR)',
      grandTotal:     199.5,
      currency:       'TRY',
      ordersListUrl:  storefrontUrl('demo', '/store/hesabim/siparisler'),
      storefrontUrl:  storefrontUrl('demo', '/store'),
    });

    expect(rendered.subject).toBe('Ödeme tamamlanamadı - #ORD-FAIL-1');
    expect(rendered.html).toContain('Ödeme tamamlanamadı');
    expect(rendered.html).toContain('ORD-FAIL-1');
    expect(rendered.html).toContain('199.50');
    expect(rendered.html).toContain('Demo Mağaza');
    expect(rendered.html).toContain('yeniden sipariş oluşturabilir');
    expect(rendered.html).toContain('Siparişlerim');
    expect(rendered.html).not.toMatch(/merchant_oid|merchant_key|merchant_salt|failed_reason/i);
    expect(rendered.html).not.toMatch(/Siparişiniz iptal edildi/i);
  });
});

describe('STORE_ORDER_PAYMENT_RECEIVED template', () => {
  it('renders payment confirmation without card or merchant details', () => {
    const rendered = renderEmailTemplate('STORE_ORDER_PAYMENT_RECEIVED', {
      storeName:  'Demo Mağaza',
      logoUrl:    null,
      tenantSlug: 'demo',
      customerName:   'Ali Veli',
      orderNumber:    'ORD-PAY-1',
      orderDate:      '25 Mayıs 2026 14:30',
      paymentMethod:  'Kredi Kartı (PayTR)',
      grandTotal:     499.9,
      currency:       'TRY',
      orderDetailUrl: storefrontUrl('demo', '/store/hesabim/siparisler/ORD-PAY-1'),
      storefrontUrl:  storefrontUrl('demo', '/store'),
    });

    expect(rendered.subject).toMatch(/Ödemeniz alındı/i);
    expect(rendered.subject).toContain('ORD-PAY-1');
    expect(rendered.html).toContain('hazırlanacaktır');
    expect(rendered.html).toContain('499.90');
    expect(rendered.html).toContain('PayTR');
    expect(rendered.html).not.toMatch(/merchant_oid|kart numarası|cvv/i);
  });
});

describe('shouldSendPaytrPaymentFailedNotification', () => {
  it('allows mail only on first failed path (INITIATED session, PENDING order)', () => {
    expect(shouldSendPaytrPaymentFailedNotification('INITIATED', 'PENDING')).toBe(true);
  });

  it('blocks repeat failed callback and non-pending orders', () => {
    expect(shouldSendPaytrPaymentFailedNotification('FAILED', 'CANCELLED')).toBe(false);
    expect(shouldSendPaytrPaymentFailedNotification('FAILED', 'PENDING')).toBe(false);
    expect(shouldSendPaytrPaymentFailedNotification('INITIATED', 'CANCELLED')).toBe(false);
    expect(shouldSendPaytrPaymentFailedNotification('INITIATED', 'PAID')).toBe(false);
    expect(shouldSendPaytrPaymentFailedNotification('SUCCESS', 'PENDING')).toBe(false);
  });
});

describe('shouldSendBankTransferPaymentApproved', () => {
  it('triggers only for BANK_TRANSFER PENDING → PAID or PROCESSING', () => {
    expect(shouldSendBankTransferPaymentApproved('BANK_TRANSFER', 'PENDING', 'PAID')).toBe(true);
    expect(shouldSendBankTransferPaymentApproved('BANK_TRANSFER', 'PENDING', 'PROCESSING')).toBe(true);
  });

  it('does not trigger for PayTR, COD, or repeat transitions', () => {
    expect(shouldSendBankTransferPaymentApproved('PAYTR', 'PENDING', 'PAID')).toBe(false);
    expect(shouldSendBankTransferPaymentApproved('CASH_ON_DELIVERY', 'PENDING', 'PROCESSING')).toBe(false);
    expect(shouldSendBankTransferPaymentApproved('BANK_TRANSFER', 'PAID', 'PROCESSING')).toBe(false);
    expect(shouldSendBankTransferPaymentApproved('BANK_TRANSFER', 'PROCESSING', 'SHIPPED')).toBe(false);
    expect(shouldSendBankTransferPaymentApproved('BANK_TRANSFER', 'PENDING', 'PENDING')).toBe(false);
    expect(
      shouldSendBankTransferPaymentApproved('BANK_TRANSFER', 'PENDING', 'PROCESSING', {
        bankTransferApprovedEmailSentAt: new Date(),
      }),
    ).toBe(false);
    expect(
      shouldSendBankTransferPaymentApproved('BANK_TRANSFER', 'PENDING', 'PAID', {
        paymentStatus: 'APPROVED',
      }),
    ).toBe(false);
  });
});

describe('shouldSendCustomerStatusEmail', () => {
  it('sends only when notifyCustomer is true and status is notifiable', () => {
    expect(shouldSendCustomerStatusEmail(true, 'PAID', 'CANCELLED')).toBe(true);
    expect(shouldSendCustomerStatusEmail(true, 'PROCESSING', 'SHIPPED')).toBe(true);
  });

  it('blocks PayTR-style callback when notifyCustomer is false', () => {
    expect(shouldSendCustomerStatusEmail(false, 'PENDING', 'CANCELLED')).toBe(false);
    expect(shouldSendCustomerStatusEmail(false, 'PENDING', 'PAID')).toBe(false);
    expect(shouldSendCustomerStatusEmail(false, 'PAID', 'SHIPPED')).toBe(false);
  });

  it('admin CANCELLED with notifyCustomer true still notifies', () => {
    expect(shouldSendCustomerStatusEmail(true, 'PAID', 'CANCELLED')).toBe(true);
  });

  it('skips PROCESSING status mail for BANK_TRANSFER payment approval', () => {
    expect(
      shouldSendCustomerStatusEmail(true, 'PENDING', 'PROCESSING', 'BANK_TRANSFER'),
    ).toBe(false);
    expect(
      shouldSendCustomerStatusEmail(true, 'PROCESSING', 'SHIPPED', 'BANK_TRANSFER'),
    ).toBe(true);
  });

  it('skips repeat SHIPPED mail when shippingNotificationSentAt is set', () => {
    expect(
      shouldSendCustomerStatusEmail(true, 'PROCESSING', 'SHIPPED', null, {
        shippingNotificationSentAt: new Date(),
      }),
    ).toBe(false);
    expect(
      shouldSendCustomerStatusEmail(true, 'SHIPPED', 'DELIVERED', null, {
        shippingNotificationSentAt: new Date(),
      }),
    ).toBe(true);
  });
});

describe('STORE_ORDER_STATUS_UPDATED SHIPPED shipping block', () => {
  it('shows carrier and tracking when provided', () => {
    const rendered = renderEmailTemplate('STORE_ORDER_STATUS_UPDATED', {
      storeName:  'Demo Mağaza',
      logoUrl:    null,
      tenantSlug: 'demo',
      customerName:   'Ali Veli',
      orderNumber:    'ORD-SHIP-1',
      orderDate:      '25 Mayıs 2026',
      newStatus:      'SHIPPED',
      statusLabel:    'Kargoya Verildi',
      statusHeadline: 'Siparişiniz kargoya verildi',
      statusMessage:  'Kargoya teslim edildi.',
      grandTotal:     199,
      currency:       'TRY',
      orderDetailUrl: storefrontUrl('demo', '/store/hesabim/siparisler/ORD-SHIP-1'),
      storefrontUrl:  storefrontUrl('demo', '/store'),
      shippingCarrier:        'Aras Kargo',
      shippingTrackingNumber: 'TRK123456',
      shippingTrackingUrl:    'https://kargo.example/track/TRK123456',
    });

    expect(rendered.subject).toContain('kargoya verildi');
    expect(rendered.html).toContain('Aras Kargo');
    expect(rendered.html).toContain('TRK123456');
    expect(rendered.html).toContain('Kargomu Takip Et');
    expect(rendered.html).not.toMatch(/credentialsEncrypted|tenantId/i);
  });

  it('shows fallback when no tracking info', () => {
    const rendered = renderEmailTemplate('STORE_ORDER_STATUS_UPDATED', {
      storeName:  'Demo Mağaza',
      logoUrl:    null,
      tenantSlug: 'demo',
      customerName:   'Ali Veli',
      orderNumber:    'ORD-SHIP-2',
      orderDate:      '25 Mayıs 2026',
      newStatus:      'SHIPPED',
      statusLabel:    'Kargoya Verildi',
      statusHeadline: 'Siparişiniz kargoya verildi',
      statusMessage:  'Kargoya teslim edildi.',
      grandTotal:     100,
      currency:       'TRY',
      orderDetailUrl: storefrontUrl('demo', '/store/hesabim/siparisler/ORD-SHIP-2'),
      storefrontUrl:  storefrontUrl('demo', '/store'),
    });

    expect(rendered.html).toContain('Takip bilgileri mağaza tarafından ayrıca paylaşılacaktır');
  });
});

describe('shouldNotifyCustomerOrderStatus', () => {
  it('notifies only for PROCESSING, SHIPPED, DELIVERED, CANCELLED when status changes', () => {
    expect(shouldNotifyCustomerOrderStatus('PENDING', 'PROCESSING')).toBe(true);
    expect(shouldNotifyCustomerOrderStatus('PAID', 'SHIPPED')).toBe(true);
    expect(shouldNotifyCustomerOrderStatus('SHIPPED', 'DELIVERED')).toBe(true);
    expect(shouldNotifyCustomerOrderStatus('PENDING', 'CANCELLED')).toBe(true);
  });

  it('skips PAID, PENDING and unchanged status', () => {
    expect(shouldNotifyCustomerOrderStatus('PENDING', 'PAID')).toBe(false);
    expect(shouldNotifyCustomerOrderStatus('PENDING', 'PENDING')).toBe(false);
    expect(shouldNotifyCustomerOrderStatus('SHIPPED', 'SHIPPED')).toBe(false);
    expect(shouldNotifyCustomerOrderStatus('PAID', 'PAID')).toBe(false);
  });
});

describe('store email labels', () => {
  it('paymentMethodLabel maps known providers', () => {
    expect(paymentMethodLabel('PAYTR')).toBe('Kredi Kartı (PayTR)');
    expect(paymentMethodLabel(null)).toBe('Belirtilmedi');
  });

  it('storefrontUrl always includes tenant query param', () => {
    const url = storefrontUrl('demo-shop', '/store/hesabim/siparisler/ORD-1');
    expect(url).toContain('tenant=demo-shop');
    expect(url).toContain('/store/hesabim/siparisler/ORD-1');
  });
});

describe('storeEmailService notifyBankTransferPaymentApproved', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('queues approval mail and appends idempotency marker', async () => {
    const sendEmailAsync = vi.fn().mockResolvedValue(undefined);
    const orderUpdate = vi.fn().mockResolvedValue({});
    vi.doMock('../../src/queues/email.queue', () => ({ sendEmailAsync }));
    vi.doMock('../../src/config/database', () => ({
      default: {
        tenant: { findFirst: vi.fn().mockResolvedValue({ name: 'Demo', slug: 'demo', logoUrl: null }) },
        order: {
          findFirst: vi.fn().mockResolvedValue({
            orderNumber: 'ORD-APP-2',
            currency: 'TRY',
            totalAmount: 300,
            createdAt: new Date('2026-05-25T12:00:00Z'),
            paymentProvider: 'BANK_TRANSFER',
            notes: '[Ödeme yöntemi: BANK_TRANSFER]',
            customer: { email: 'buyer@test.com', firstName: 'Ali', lastName: 'Veli' },
          }),
          update: orderUpdate,
        },
      },
    }));

    const { storeEmailService } = await import('../../src/modules/store-public/store-email.service');
    await storeEmailService.notifyBankTransferPaymentApproved('t1', 'o1');

    expect(sendEmailAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@test.com',
        template: 'STORE_ORDER_BANK_TRANSFER_APPROVED',
      }),
    );
    expect(orderUpdate).toHaveBeenCalled();
  });

  it('skips when bankTransferApprovedEmailSentAt already set', async () => {
    const sendEmailAsync = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../src/queues/email.queue', () => ({ sendEmailAsync }));
    vi.doMock('../../src/config/database', () => ({
      default: {
        tenant: { findFirst: vi.fn().mockResolvedValue({ name: 'Demo', slug: 'demo', logoUrl: null }) },
        order: {
          findFirst: vi.fn().mockResolvedValue({
            orderNumber: 'ORD-APP-3',
            currency: 'TRY',
            totalAmount: 100,
            createdAt: new Date(),
            paymentProvider: 'BANK_TRANSFER',
            bankTransferApprovedEmailSentAt: new Date(),
            notes: '[Ödeme yöntemi: BANK_TRANSFER]',
            customer: { email: 'a@test.com', firstName: 'A', lastName: 'B' },
          }),
        },
      },
    }));

    const { storeEmailService } = await import('../../src/modules/store-public/store-email.service');
    await storeEmailService.notifyBankTransferPaymentApproved('t1', 'o1');
    expect(sendEmailAsync).not.toHaveBeenCalled();
  });
});

describe('storeEmailService notifyBankTransferPaymentPending', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('queues bank transfer mail when order and bank settings exist', async () => {
    const sendEmailAsync = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../src/queues/email.queue', () => ({ sendEmailAsync }));
    vi.doMock('../../src/config/database', () => ({
      default: {
        tenant: { findFirst: vi.fn().mockResolvedValue({ name: 'Demo', slug: 'demo', logoUrl: null }) },
        order: {
          findFirst: vi.fn().mockResolvedValue({
            orderNumber: 'ORD-BT-2',
            currency: 'TRY',
            totalAmount: 200,
            createdAt: new Date('2026-05-25T12:00:00Z'),
            paymentProvider: 'BANK_TRANSFER',
            bankTransferPendingEmailSentAt: null,
            customer: { email: 'buyer@test.com', firstName: 'Ali', lastName: 'Veli' },
          }),
          update: vi.fn().mockResolvedValue({}),
        },
      },
    }));
    vi.doMock('../../src/modules/payments/tenant-payment-settings.service', () => ({
      tenantPaymentSettingsService: {
        getActiveBankTransferDetails: vi.fn().mockResolvedValue({
          bankName: 'Test Bank',
          accountHolder: 'Demo',
          iban: 'TR330006100519786457841326',
          description: 'Not',
        }),
      },
    }));

    const { storeEmailService } = await import('../../src/modules/store-public/store-email.service');
    await storeEmailService.notifyBankTransferPaymentPending('t1', 'o1');

    expect(sendEmailAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@test.com',
        template: 'STORE_ORDER_BANK_TRANSFER_PENDING',
      }),
    );
  });

  it('does not throw when bank settings missing', async () => {
    vi.doMock('../../src/queues/email.queue', () => ({
      sendEmailAsync: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../../src/config/database', () => ({
      default: {
        tenant: { findFirst: vi.fn().mockResolvedValue({ name: 'Demo', slug: 'demo', logoUrl: null }) },
        order: {
          findFirst: vi.fn().mockResolvedValue({
            orderNumber: 'ORD-BT-3',
            currency: 'TRY',
            totalAmount: 100,
            createdAt: new Date(),
            customer: { email: 'a@test.com', firstName: 'A', lastName: 'B' },
          }),
        },
      },
    }));
    vi.doMock('../../src/modules/payments/tenant-payment-settings.service', () => ({
      tenantPaymentSettingsService: {
        getActiveBankTransferDetails: vi.fn().mockResolvedValue(null),
      },
    }));

    const { storeEmailService } = await import('../../src/modules/store-public/store-email.service');
    await expect(
      storeEmailService.notifyBankTransferPaymentPending('t1', 'o1'),
    ).resolves.toBeUndefined();
  });
});

describe('storeEmailService notifyCashOnDeliveryOrderCreated', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('queues COD mail and sets cashOnDeliveryEmailSentAt', async () => {
    const sendEmailAsync = vi.fn().mockResolvedValue(undefined);
    const orderUpdate = vi.fn().mockResolvedValue({});
    vi.doMock('../../src/queues/email.queue', () => ({ sendEmailAsync }));
    vi.doMock('../../src/config/database', () => ({
      default: {
        tenant: { findFirst: vi.fn().mockResolvedValue({ name: 'Demo', slug: 'demo', logoUrl: null }) },
        order: {
          findFirst: vi.fn().mockResolvedValue({
            orderNumber: 'ORD-COD-3',
            currency: 'TRY',
            totalAmount: 250,
            shippingPrice: 20,
            createdAt: new Date('2026-05-25T12:00:00Z'),
            paymentProvider: 'CASH_ON_DELIVERY',
            cashOnDeliveryEmailSentAt: null,
            notes: '[Ödeme yöntemi: CASH_ON_DELIVERY]',
            customer: { email: 'buyer@test.com', firstName: 'Ali', lastName: 'Veli' },
            items: [{ quantity: 1, price: 200 }],
          }),
          update: orderUpdate,
        },
      },
    }));

    const { storeEmailService } = await import('../../src/modules/store-public/store-email.service');
    await storeEmailService.notifyCashOnDeliveryOrderCreated('t1', 'o1', {
      cashOnDeliveryFee: 10,
    });

    expect(sendEmailAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@test.com',
        template: 'STORE_ORDER_CASH_ON_DELIVERY_CREATED',
      }),
    );
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cashOnDeliveryEmailSentAt: expect.any(Date) }),
      }),
    );
  });

  it('skips when cashOnDeliveryEmailSentAt already set', async () => {
    const sendEmailAsync = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../src/queues/email.queue', () => ({ sendEmailAsync }));
    vi.doMock('../../src/config/database', () => ({
      default: {
        tenant: { findFirst: vi.fn().mockResolvedValue({ name: 'Demo', slug: 'demo', logoUrl: null }) },
        order: {
          findFirst: vi.fn().mockResolvedValue({
            orderNumber: 'ORD-COD-4',
            currency: 'TRY',
            totalAmount: 100,
            createdAt: new Date(),
            paymentProvider: 'CASH_ON_DELIVERY',
            cashOnDeliveryEmailSentAt: new Date(),
            customer: { email: 'a@test.com', firstName: 'A', lastName: 'B' },
            items: [],
          }),
        },
      },
    }));

    const { storeEmailService } = await import('../../src/modules/store-public/store-email.service');
    await storeEmailService.notifyCashOnDeliveryOrderCreated('t1', 'o1');
    expect(sendEmailAsync).not.toHaveBeenCalled();
  });

  it('does not queue for PAYTR or BANK_TRANSFER', async () => {
    const sendEmailAsync = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../src/queues/email.queue', () => ({ sendEmailAsync }));
    vi.doMock('../../src/config/database', () => ({
      default: {
        tenant: { findFirst: vi.fn().mockResolvedValue({ name: 'Demo', slug: 'demo', logoUrl: null }) },
        order: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({
              orderNumber: 'ORD-PAY',
              currency: 'TRY',
              totalAmount: 100,
              createdAt: new Date(),
              paymentProvider: 'PAYTR',
              customer: { email: 'a@test.com', firstName: 'A', lastName: 'B' },
              items: [],
            })
            .mockResolvedValueOnce({
              orderNumber: 'ORD-BT',
              currency: 'TRY',
              totalAmount: 100,
              createdAt: new Date(),
              paymentProvider: 'BANK_TRANSFER',
              customer: { email: 'b@test.com', firstName: 'B', lastName: 'C' },
              items: [],
            }),
        },
      },
    }));

    const { storeEmailService } = await import('../../src/modules/store-public/store-email.service');
    await storeEmailService.notifyCashOnDeliveryOrderCreated('t1', 'o-pay');
    await storeEmailService.notifyCashOnDeliveryOrderCreated('t1', 'o-bt');
    expect(sendEmailAsync).not.toHaveBeenCalled();
  });

  it('does not throw when customer email missing', async () => {
    const sendEmailAsync = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../src/queues/email.queue', () => ({ sendEmailAsync }));
    vi.doMock('../../src/config/database', () => ({
      default: {
        tenant: { findFirst: vi.fn().mockResolvedValue({ name: 'Demo', slug: 'demo', logoUrl: null }) },
        order: {
          findFirst: vi.fn().mockResolvedValue({
            orderNumber: 'ORD-COD-5',
            currency: 'TRY',
            totalAmount: 50,
            createdAt: new Date(),
            paymentProvider: 'CASH_ON_DELIVERY',
            customer: { email: '', firstName: 'A', lastName: 'B' },
            items: [],
          }),
        },
      },
    }));

    const { storeEmailService } = await import('../../src/modules/store-public/store-email.service');
    await expect(
      storeEmailService.notifyCashOnDeliveryOrderCreated('t1', 'o1'),
    ).resolves.toBeUndefined();
    expect(sendEmailAsync).not.toHaveBeenCalled();
  });
});

describe('storeEmailService queue integration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('notifyOrderCreated queues email without throwing when send fails', async () => {
    vi.doMock('../../src/queues/email.queue', () => ({
      sendEmailAsync: vi.fn().mockRejectedValue(new Error('SMTP down')),
    }));
    vi.doMock('../../src/config/database', () => ({
      default: {
        tenant: { findFirst: vi.fn().mockResolvedValue({ name: 'Demo', slug: 'demo', logoUrl: null }) },
        order: {
          findFirst: vi.fn().mockResolvedValue({
            orderNumber: 'ORD-1',
            currency: 'TRY',
            totalAmount: 100,
            shippingPrice: 10,
            customer: { email: 'a@test.com', firstName: 'A', lastName: 'B' },
            items: [{ quantity: 1, price: 90 }],
          }),
        },
      },
    }));

    const { storeEmailService } = await import('../../src/modules/store-public/store-email.service');
    await expect(storeEmailService.notifyOrderCreated('t1', 'o1')).resolves.toBeUndefined();
  });
});
