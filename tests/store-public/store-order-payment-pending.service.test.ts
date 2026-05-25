import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database', () => ({
  default: {
    order: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../src/modules/payments/tenant-payment-settings.service', () => ({
  tenantPaymentSettingsService: {
    getActiveBankTransferDetails: vi.fn(),
  },
}));

vi.mock('../../src/modules/store-public/store-email.service', () => ({
  storeEmailService: {
    resendBankTransferPaymentPendingEmail: vi.fn(),
  },
}));

import prisma from '../../src/config/database';
import { tenantPaymentSettingsService } from '../../src/modules/payments/tenant-payment-settings.service';
import { storeEmailService } from '../../src/modules/store-public/store-email.service';
import {
  BANK_TRANSFER_RESEND_COOLDOWN_MS,
  StoreOrderPaymentPendingService,
} from '../../src/modules/store-public/store-order-payment-pending.service';

const bankDetails = {
  bankName: 'Ziraat',
  accountHolder: 'Mağaza',
  iban: 'TR330006100519786457841326',
  description: '',
};

function eligibleOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    orderNumber: 'ORD-R1',
    status: 'PENDING',
    paymentProvider: 'BANK_TRANSFER',
    paymentStatus: 'WAITING_BANK_TRANSFER',
    notes: null,
    bankTransferPendingEmailSentAt: new Date('2026-05-25T10:00:00Z'),
    bankTransferPendingEmailLastResentAt: null,
    customer: { email: 'buyer@test.com' },
    ...overrides,
  };
}

describe('StoreOrderPaymentPendingService', () => {
  const svc = new StoreOrderPaymentPendingService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when order not in tenant', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null);
    const r = await svc.getByOrderNumber('tenant-1', 'ORD-999');
    expect(r).toBeNull();
  });

  it('returns bank transfer details for waiting payment', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue({
      orderNumber: 'ORD-100',
      status: 'PENDING',
      paymentProvider: 'BANK_TRANSFER',
      paymentStatus: 'WAITING_BANK_TRANSFER',
      totalAmount: 1250,
      currency: 'TRY',
      createdAt: new Date('2026-05-25T10:00:00Z'),
      notes: null,
    } as never);
    vi.mocked(tenantPaymentSettingsService.getActiveBankTransferDetails).mockResolvedValue(bankDetails);

    const r = await svc.getByOrderNumber('tenant-1', 'ORD-100');
    expect(r?.bankTransferPayment?.paymentReference).toBe('ORD-100');
  });

  it('returns paymentApprovedAt for approved bank transfer', async () => {
    const approved = new Date('2026-05-25T14:30:00Z');
    vi.mocked(prisma.order.findFirst).mockResolvedValue({
      orderNumber: 'ORD-AP',
      status: 'PROCESSING',
      paymentProvider: 'BANK_TRANSFER',
      paymentStatus: 'APPROVED',
      totalAmount: 500,
      currency: 'TRY',
      createdAt: new Date('2026-05-25T10:00:00Z'),
      paymentApprovedAt: approved,
      notes: null,
    } as never);

    const r = await svc.getByOrderNumber('tenant-1', 'ORD-AP');
    expect(r?.order.paymentApprovedAt).toBe(approved.toISOString());
    expect(r?.bankTransferPayment).toBeNull();
    expect(r?.order).not.toHaveProperty('customer');
  });
});

describe('StoreOrderPaymentPendingService.resendPaymentPendingEmail', () => {
  const svc = new StoreOrderPaymentPendingService();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tenantPaymentSettingsService.getActiveBankTransferDetails).mockResolvedValue(bankDetails);
    vi.mocked(prisma.order.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(storeEmailService.resendBankTransferPaymentPendingEmail).mockResolvedValue(true);
  });

  it('sends email and claims cooldown via updateMany', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(eligibleOrder() as never);

    const r = await svc.resendPaymentPendingEmail('tenant-1', 'ORD-R1');
    expect(r.success).toBe(true);
    expect(storeEmailService.resendBankTransferPaymentPendingEmail).toHaveBeenCalledWith('tenant-1', 'o1');
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'o1', tenantId: 'tenant-1' }),
        data: { bankTransferPendingEmailLastResentAt: expect.any(Date) },
      }),
    );
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('blocks resend when lastResentAt is within cooldown', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      eligibleOrder({
        bankTransferPendingEmailLastResentAt: new Date(),
      }) as never,
    );

    const r = await svc.resendPaymentPendingEmail('tenant-1', 'ORD-R1');
    expect(r.success).toBe(false);
    expect(r.statusCode).toBe(429);
    expect(r.message).toContain('sonra tekrar');
    expect(storeEmailService.resendBankTransferPaymentPendingEmail).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('allows resend when lastResentAt is older than cooldown', async () => {
    const old = new Date(Date.now() - BANK_TRANSFER_RESEND_COOLDOWN_MS - 1000);
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      eligibleOrder({ bankTransferPendingEmailLastResentAt: old }) as never,
    );

    const r = await svc.resendPaymentPendingEmail('tenant-1', 'ORD-R1');
    expect(r.success).toBe(true);
    expect(storeEmailService.resendBankTransferPaymentPendingEmail).toHaveBeenCalled();
  });

  it('does not change bankTransferPendingEmailSentAt on resend', async () => {
    const firstSent = new Date('2026-05-25T10:00:00Z');
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      eligibleOrder({ bankTransferPendingEmailSentAt: firstSent }) as never,
    );

    await svc.resendPaymentPendingEmail('tenant-1', 'ORD-R1');

    const updateManyCall = vi.mocked(prisma.order.updateMany).mock.calls[0]?.[0];
    expect(updateManyCall?.data).toEqual({ bankTransferPendingEmailLastResentAt: expect.any(Date) });
    expect(updateManyCall?.data).not.toHaveProperty('bankTransferPendingEmailSentAt');
  });

  it('reverts lastResentAt when mail send fails', async () => {
    const previous = new Date('2026-05-20T10:00:00Z');
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      eligibleOrder({ bankTransferPendingEmailLastResentAt: previous }) as never,
    );
    vi.mocked(storeEmailService.resendBankTransferPaymentPendingEmail).mockResolvedValue(false);

    const r = await svc.resendPaymentPendingEmail('tenant-1', 'ORD-R1');
    expect(r.success).toBe(false);
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { bankTransferPendingEmailLastResentAt: previous },
    });
  });

  it('returns cooldown when updateMany claim fails (race)', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(eligibleOrder() as never);
    vi.mocked(prisma.order.updateMany).mockResolvedValue({ count: 0 });

    const r = await svc.resendPaymentPendingEmail('tenant-1', 'ORD-R1');
    expect(r.statusCode).toBe(429);
    expect(storeEmailService.resendBankTransferPaymentPendingEmail).not.toHaveBeenCalled();
  });

  it('rejects PAID bank transfer', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      eligibleOrder({ paymentStatus: 'PAID' }) as never,
    );

    const r = await svc.resendPaymentPendingEmail('tenant-1', 'ORD-R1');
    expect(r.success).toBe(false);
    expect(storeEmailService.resendBankTransferPaymentPendingEmail).not.toHaveBeenCalled();
  });

  it('rejects PAYTR order', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      eligibleOrder({ paymentProvider: 'PAYTR', paymentStatus: 'PENDING' }) as never,
    );

    const r = await svc.resendPaymentPendingEmail('tenant-1', 'ORD-R1');
    expect(r.success).toBe(false);
  });
});
