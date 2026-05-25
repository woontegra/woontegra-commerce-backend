import prisma from '../../config/database';
import { tenantPaymentSettingsService } from '../payments/tenant-payment-settings.service';
import {
  buildCustomerBankTransferPayment,
  buildCustomerOrderPayment,
  type CustomerBankTransferPaymentPublic,
  shouldShowCustomerBankTransferPayment,
} from './store-account.presenter';
import { storeEmailService } from './store-email.service';

/** Sipariş başına tekrar mail gönderim aralığı (ms). */
export const BANK_TRANSFER_RESEND_COOLDOWN_MS = 5 * 60 * 1000;

export type ResendPaymentPendingEmailResult = {
  success:    boolean;
  message:    string;
  statusCode: number;
};

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

function isResendCooldownActive(lastResentAt: Date | null | undefined, now = Date.now()): boolean {
  if (!lastResentAt) return false;
  return now - lastResentAt.getTime() < BANK_TRANSFER_RESEND_COOLDOWN_MS;
}

export type StoreOrderPaymentPendingPublic = {
  order: {
    orderNumber:          string;
    status:               string;
    paymentProvider:      string | null;
    paymentStatus:        string | null;
    paymentProviderLabel: string;
    paymentStatusLabel:   string;
    totalAmount:          number;
    currency:             string;
    createdAt:            string;
    paymentApprovedAt:    string | null;
  };
  bankTransferPayment: CustomerBankTransferPaymentPublic | null;
};

export class StoreOrderPaymentPendingService {
  /** Vitrin — ödeme bekleniyor sayfası; minimum alan, tenant scope. */
  async getByOrderNumber(
    tenantId: string,
    orderNumber: string,
  ): Promise<StoreOrderPaymentPendingPublic | null> {
    const decoded = decodeURIComponent(orderNumber).trim();
    if (!decoded) return null;

    const order = await prisma.order.findFirst({
      where: { tenantId, orderNumber: decoded },
      select: {
        orderNumber:     true,
        status:          true,
        paymentProvider: true,
        paymentStatus:   true,
        totalAmount:     true,
        currency:        true,
        createdAt:       true,
        paymentApprovedAt: true,
        notes:           true,
      },
    });

    if (!order) return null;

    const payment = buildCustomerOrderPayment(order);

    let bankTransferPayment: CustomerBankTransferPaymentPublic | null = null;
    if (shouldShowCustomerBankTransferPayment(order)) {
      const bankDetails = await tenantPaymentSettingsService.getActiveBankTransferDetails(tenantId);
      bankTransferPayment = buildCustomerBankTransferPayment(order.orderNumber, bankDetails);
    }

    return {
      order: {
        orderNumber:          order.orderNumber,
        status:               String(order.status),
        paymentProvider:      payment.provider,
        paymentStatus:        payment.status,
        paymentProviderLabel: payment.providerLabel,
        paymentStatusLabel:   payment.statusLabel,
        totalAmount:          num(order.totalAmount),
        currency:             order.currency,
        createdAt:            order.createdAt.toISOString(),
        paymentApprovedAt:    order.paymentApprovedAt
          ? order.paymentApprovedAt.toISOString()
          : null,
      },
      bankTransferPayment,
    };
  }

  /**
   * Sipariş bazlı cooldown kilidi — yarış durumunda tek istek geçer.
   * Başarısız mail sonrası önceki timestamp geri alınır.
   */
  private async claimResendCooldownSlot(orderId: string, tenantId: string): Promise<boolean> {
    const now = new Date();
    const cooldownThreshold = new Date(now.getTime() - BANK_TRANSFER_RESEND_COOLDOWN_MS);

    const claimed = await prisma.order.updateMany({
      where: {
        id: orderId,
        tenantId,
        OR: [
          { bankTransferPendingEmailLastResentAt: null },
          { bankTransferPendingEmailLastResentAt: { lt: cooldownThreshold } },
        ],
      },
      data: { bankTransferPendingEmailLastResentAt: now },
    });

    return claimed.count === 1;
  }

  /** Vitrin — Havale/EFT ödeme bilgisi maili tekrar gönder (public, minimum yanıt). */
  async resendPaymentPendingEmail(
    tenantId: string,
    orderNumber: string,
  ): Promise<ResendPaymentPendingEmailResult> {
    const decoded = decodeURIComponent(orderNumber).trim();
    const ineligibleMessage = 'Bu sipariş için ödeme bilgileri tekrar gönderilemez.';
    const sendFailedMessage =
      'Ödeme bilgileri şu anda gönderilemedi. Lütfen daha sonra tekrar deneyin.';

    if (!decoded) {
      return { success: false, message: ineligibleMessage, statusCode: 400 };
    }

    const order = await prisma.order.findFirst({
      where: { tenantId, orderNumber: decoded },
      select: {
        id:                                 true,
        orderNumber:                        true,
        status:                             true,
        paymentProvider:                    true,
        paymentStatus:                      true,
        notes:                              true,
        bankTransferPendingEmailSentAt:     true,
        bankTransferPendingEmailLastResentAt: true,
        customer:                           { select: { email: true } },
      },
    });

    if (!order) {
      return { success: false, message: ineligibleMessage, statusCode: 404 };
    }

    if (isResendCooldownActive(order.bankTransferPendingEmailLastResentAt)) {
      return {
        success: false,
        message: 'Lütfen bir süre sonra tekrar deneyin.',
        statusCode: 429,
      };
    }

    if (!shouldShowCustomerBankTransferPayment(order)) {
      return { success: false, message: ineligibleMessage, statusCode: 400 };
    }

    const bankDetails = await tenantPaymentSettingsService.getActiveBankTransferDetails(tenantId);
    if (!bankDetails || !buildCustomerBankTransferPayment(order.orderNumber, bankDetails)) {
      return { success: false, message: ineligibleMessage, statusCode: 400 };
    }

    if (!order.customer?.email?.trim()) {
      return { success: false, message: ineligibleMessage, statusCode: 400 };
    }

    const previousLastResent = order.bankTransferPendingEmailLastResentAt;
    const claimed = await this.claimResendCooldownSlot(order.id, tenantId);
    if (!claimed) {
      return {
        success: false,
        message: 'Lütfen bir süre sonra tekrar deneyin.',
        statusCode: 429,
      };
    }

    const sent = await storeEmailService.resendBankTransferPaymentPendingEmail(tenantId, order.id);
    if (!sent) {
      await prisma.order.update({
        where: { id: order.id },
        data:  { bankTransferPendingEmailLastResentAt: previousLastResent },
      });
      return { success: false, message: sendFailedMessage, statusCode: 500 };
    }

    return {
      success: true,
      message: 'Ödeme bilgileri e-posta adresinize gönderildi.',
      statusCode: 200,
    };
  }
}

export const storeOrderPaymentPendingService = new StoreOrderPaymentPendingService();
