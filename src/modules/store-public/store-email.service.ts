import prisma from '../../config/database';
import { logger } from '../../config/logger';
import { sendEmailAsync } from '../../queues/email.queue';
import { tenantPaymentSettingsService } from '../payments/tenant-payment-settings.service';
import {
  orderStatusEmailCopy,
  paymentMethodLabel,
  refundMethodLabel,
  returnStatusLabel,
  resolveOrderPaymentProvider,
  shouldNotifyCustomerOrderStatus,
  shouldSendPaytrPaymentReceivedNotification,
  storefrontUrl,
  type StoreEmailBranding,
} from '../email/templates/store-email.util';

export { shouldNotifyCustomerOrderStatus, CUSTOMER_NOTIFY_ORDER_STATUSES } from '../email/templates/store-email.util';

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

async function loadTenantBranding(tenantId: string): Promise<StoreEmailBranding | null> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, isActive: true },
    select: { name: true, slug: true, logoUrl: true },
  });
  if (!tenant) return null;
  return {
    storeName:  tenant.name,
    logoUrl:    tenant.logoUrl,
    tenantSlug: tenant.slug,
  };
}

function customerDisplayName(firstName?: string | null, lastName?: string | null): string {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'Değerli Müşterimiz';
}

async function queueStoreTemplate(
  to: string,
  template: string,
  templateData: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<void> {
  if (!to?.trim()) {
    logger.warn({ message: '[StoreEmail] Alıcı e-postası yok, gönderim atlandı', ...context });
    return;
  }

  await sendEmailAsync({
    to: to.trim(),
    template: template as never,
    templateData,
  });

  logger.info({ message: '[StoreEmail] E-posta kuyruğa eklendi', template, to: to.trim(), ...context });
}

/** Hata fırlatmaz — ana işlemi bozmaz */
export class StoreEmailService {
  async notifyOrderCreated(
    tenantId: string,
    orderId: string,
    opts?: {
      paymentProvider?: string | null;
      itemsSubtotal?: number;
      shippingTotal?: number;
    },
  ): Promise<void> {
    try {
      const [branding, order] = await Promise.all([
        loadTenantBranding(tenantId),
        prisma.order.findFirst({
          where: { id: orderId, tenantId },
          include: {
            customer: { select: { email: true, firstName: true, lastName: true } },
            items:    { select: { quantity: true, price: true } },
          },
        }),
      ]);

      if (!branding || !order?.customer?.email) return;

      const itemsSubtotal = opts?.itemsSubtotal ?? order.items.reduce(
        (s, i) => s + i.quantity * num(i.price),
        0,
      );
      const shippingTotal = opts?.shippingTotal ?? num(order.shippingPrice);
      const grandTotal = num(order.totalAmount);

      await queueStoreTemplate(
        order.customer.email,
        'STORE_ORDER_CREATED',
        {
          ...branding,
          customerName:   customerDisplayName(order.customer.firstName, order.customer.lastName),
          orderNumber:    order.orderNumber,
          itemsSubtotal,
          shippingTotal,
          grandTotal,
          currency:       order.currency,
          paymentMethod:  paymentMethodLabel(opts?.paymentProvider),
          orderDetailUrl: storefrontUrl(
            branding.tenantSlug,
            `/store/hesabim/siparisler/${encodeURIComponent(order.orderNumber)}`,
          ),
          storefrontUrl: storefrontUrl(branding.tenantSlug, '/store'),
        },
        { tenantId, orderId },
      );
    } catch (error) {
      logger.error({
        message: '[StoreEmail] notifyOrderCreated failed',
        tenantId,
        orderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Kapıda ödeme checkout — sipariş oluşturulduktan sonra bir kez (STORE_ORDER_CREATED yerine).
   */
  async notifyCashOnDeliveryOrderCreated(
    tenantId: string,
    orderId: string,
    opts?: {
      itemsSubtotal?: number;
      shippingTotal?: number;
      cashOnDeliveryFee?: number;
    },
  ): Promise<void> {
    try {
      const [branding, order] = await Promise.all([
        loadTenantBranding(tenantId),
        prisma.order.findFirst({
          where: { id: orderId, tenantId },
          include: {
            customer: { select: { email: true, firstName: true, lastName: true } },
            items:    { select: { quantity: true, price: true } },
          },
        }),
      ]);

      if (!branding || !order) return;

      const paymentProvider = resolveOrderPaymentProvider(order);
      if (paymentProvider !== 'CASH_ON_DELIVERY') {
        logger.warn({
          message: '[StoreEmail] notifyCashOnDeliveryOrderCreated skipped — not CASH_ON_DELIVERY',
          tenantId,
          orderId,
          paymentProvider,
        });
        return;
      }

      if (order.cashOnDeliveryEmailSentAt) {
        logger.warn({
          message: '[StoreEmail] notifyCashOnDeliveryOrderCreated skipped — already sent',
          tenantId,
          orderId,
        });
        return;
      }

      const email = order.customer?.email?.trim();
      if (!email) {
        logger.warn({
          message: '[StoreEmail] notifyCashOnDeliveryOrderCreated skipped — no customer email',
          tenantId,
          orderId,
        });
        return;
      }

      const itemsSubtotal = opts?.itemsSubtotal ?? order.items.reduce(
        (s, i) => s + i.quantity * num(i.price),
        0,
      );
      const shippingTotal = opts?.shippingTotal ?? num(order.shippingPrice);
      const cashOnDeliveryFee = opts?.cashOnDeliveryFee ?? 0;
      const grandTotal = num(order.totalAmount);

      const orderDate = order.createdAt.toLocaleDateString('tr-TR', {
        year:   'numeric',
        month:  'long',
        day:    'numeric',
        hour:   '2-digit',
        minute: '2-digit',
      });

      await queueStoreTemplate(
        email,
        'STORE_ORDER_CASH_ON_DELIVERY_CREATED',
        {
          ...branding,
          customerName:      customerDisplayName(order.customer.firstName, order.customer.lastName),
          orderNumber:       order.orderNumber,
          orderDate,
          paymentMethod:     paymentMethodLabel('CASH_ON_DELIVERY'),
          itemsSubtotal,
          shippingTotal,
          cashOnDeliveryFee,
          grandTotal,
          currency:          order.currency,
          orderDetailUrl: storefrontUrl(
            branding.tenantSlug,
            `/store/hesabim/siparisler/${encodeURIComponent(order.orderNumber)}`,
          ),
          storefrontUrl: storefrontUrl(branding.tenantSlug, '/store'),
        },
        { tenantId, orderId, paymentProvider: 'CASH_ON_DELIVERY' },
      );

      await prisma.order.update({
        where: { id: orderId },
        data:  { cashOnDeliveryEmailSentAt: new Date() },
      });
    } catch (error) {
      logger.error({
        message: '[StoreEmail] notifyCashOnDeliveryOrderCreated failed',
        tenantId,
        orderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * PayTR (veya benzeri) ödeme onayı sonrası — yalnızca callback tarafından ilk PAID geçişinde çağrılmalı.
   */
  async notifyOrderPaymentReceived(
    tenantId: string,
    orderId: string,
    opts?: { paymentProvider?: string | null },
  ): Promise<void> {
    try {
      const [branding, order] = await Promise.all([
        loadTenantBranding(tenantId),
        prisma.order.findFirst({
          where: { id: orderId, tenantId, status: 'PAID' },
          include: {
            customer: { select: { email: true, firstName: true, lastName: true } },
          },
        }),
      ]);

      if (!branding || !order) return;

      if (!shouldSendPaytrPaymentReceivedNotification(order)) {
        logger.warn({
          message: '[StoreEmail] notifyOrderPaymentReceived skipped — already sent',
          tenantId,
          orderId,
        });
        return;
      }

      const email = order.customer?.email?.trim();
      if (!email) {
        logger.warn({
          message: '[StoreEmail] notifyOrderPaymentReceived skipped — no customer email',
          tenantId,
          orderId,
        });
        return;
      }

      const orderDate = order.createdAt.toLocaleDateString('tr-TR', {
        year:  'numeric',
        month: 'long',
        day:   'numeric',
        hour:  '2-digit',
        minute: '2-digit',
      });

      await queueStoreTemplate(
        email,
        'STORE_ORDER_PAYMENT_RECEIVED',
        {
          ...branding,
          customerName:   customerDisplayName(order.customer.firstName, order.customer.lastName),
          orderNumber:    order.orderNumber,
          orderDate,
          paymentMethod:  paymentMethodLabel(opts?.paymentProvider ?? 'PAYTR'),
          grandTotal:     num(order.totalAmount),
          currency:       order.currency,
          orderDetailUrl: storefrontUrl(
            branding.tenantSlug,
            `/store/hesabim/siparisler/${encodeURIComponent(order.orderNumber)}`,
          ),
          storefrontUrl: storefrontUrl(branding.tenantSlug, '/store'),
        },
        { tenantId, orderId, paymentProvider: opts?.paymentProvider ?? 'PAYTR' },
      );

      await prisma.order.update({
        where: { id: orderId },
        data:  { paymentReceivedEmailSentAt: new Date() },
      });
    } catch (error) {
      logger.error({
        message: '[StoreEmail] notifyOrderPaymentReceived failed',
        tenantId,
        orderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * PayTR ödeme başarısız callback — yalnızca ilk PENDING → CANCELLED geçişinde çağrılmalı.
   */
  async notifyOrderPaymentFailed(
    tenantId: string,
    orderId: string,
    opts?: { paymentProvider?: string | null },
  ): Promise<void> {
    try {
      const [branding, order] = await Promise.all([
        loadTenantBranding(tenantId),
        prisma.order.findFirst({
          where: { id: orderId, tenantId },
          include: {
            customer: { select: { email: true, firstName: true, lastName: true } },
          },
        }),
      ]);

      if (!branding || !order) return;

      if (order.paymentFailedEmailSentAt) {
        logger.warn({
          message: '[StoreEmail] notifyOrderPaymentFailed skipped — already sent',
          tenantId,
          orderId,
        });
        return;
      }

      const email = order.customer?.email?.trim();
      if (!email) {
        logger.warn({
          message: '[StoreEmail] notifyOrderPaymentFailed skipped — no customer email',
          tenantId,
          orderId,
        });
        return;
      }

      const orderDate = order.createdAt.toLocaleDateString('tr-TR', {
        year:   'numeric',
        month:  'long',
        day:    'numeric',
        hour:   '2-digit',
        minute: '2-digit',
      });

      await queueStoreTemplate(
        email,
        'STORE_ORDER_PAYMENT_FAILED',
        {
          ...branding,
          customerName:   customerDisplayName(order.customer.firstName, order.customer.lastName),
          orderNumber:    order.orderNumber,
          orderDate,
          paymentMethod:  paymentMethodLabel(opts?.paymentProvider ?? 'PAYTR'),
          grandTotal:     num(order.totalAmount),
          currency:       order.currency,
          ordersListUrl:  storefrontUrl(
            branding.tenantSlug,
            '/store/hesabim/siparisler',
          ),
          storefrontUrl: storefrontUrl(branding.tenantSlug, '/store'),
        },
        { tenantId, orderId, paymentProvider: opts?.paymentProvider ?? 'PAYTR' },
      );

      await prisma.order.update({
        where: { id: orderId },
        data:  { paymentFailedEmailSentAt: new Date() },
      });
    } catch (error) {
      logger.error({
        message: '[StoreEmail] notifyOrderPaymentFailed failed',
        tenantId,
        orderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Havale/EFT checkout — sipariş oluşturulduktan sonra bir kez (ödeme bekleniyor bilgileri).
   */
  async notifyBankTransferPaymentPending(tenantId: string, orderId: string): Promise<void> {
    try {
      const [branding, order, bank] = await Promise.all([
        loadTenantBranding(tenantId),
        prisma.order.findFirst({
          where: { id: orderId, tenantId },
          include: {
            customer: { select: { email: true, firstName: true, lastName: true } },
          },
        }),
        tenantPaymentSettingsService.getActiveBankTransferDetails(tenantId),
      ]);

      if (!branding || !order) return;

      if (order.bankTransferPendingEmailSentAt) {
        logger.warn({
          message: '[StoreEmail] notifyBankTransferPaymentPending skipped — already sent',
          tenantId,
          orderId,
        });
        return;
      }

      if (resolveOrderPaymentProvider(order) !== 'BANK_TRANSFER') return;

      if (!bank) {
        logger.warn({
          message: '[StoreEmail] notifyBankTransferPaymentPending skipped — BANK_TRANSFER not active or incomplete',
          tenantId,
          orderId,
        });
        return;
      }

      const email = order.customer?.email?.trim();
      if (!email) {
        logger.warn({
          message: '[StoreEmail] notifyBankTransferPaymentPending skipped — no customer email',
          tenantId,
          orderId,
        });
        return;
      }

      const orderDate = order.createdAt.toLocaleDateString('tr-TR', {
        year:   'numeric',
        month:  'long',
        day:    'numeric',
        hour:   '2-digit',
        minute: '2-digit',
      });

      await queueStoreTemplate(
        email,
        'STORE_ORDER_BANK_TRANSFER_PENDING',
        {
          ...branding,
          customerName:   customerDisplayName(order.customer.firstName, order.customer.lastName),
          orderNumber:    order.orderNumber,
          orderDate,
          paymentMethod:  paymentMethodLabel('BANK_TRANSFER'),
          grandTotal:     num(order.totalAmount),
          currency:       order.currency,
          bankName:       bank.bankName,
          accountHolder:  bank.accountHolder,
          iban:           bank.iban,
          paymentNote:    bank.description,
          orderDetailUrl: storefrontUrl(
            branding.tenantSlug,
            `/store/hesabim/siparisler/${encodeURIComponent(order.orderNumber)}`,
          ),
          ordersListUrl:  storefrontUrl(
            branding.tenantSlug,
            '/store/hesabim/siparisler',
          ),
          storefrontUrl: storefrontUrl(branding.tenantSlug, '/store'),
        },
        { tenantId, orderId, paymentProvider: 'BANK_TRANSFER' },
      );

      await prisma.order.update({
        where: { id: orderId },
        data:  { bankTransferPendingEmailSentAt: new Date() },
      });
    } catch (error) {
      logger.error({
        message: '[StoreEmail] notifyBankTransferPaymentPending failed',
        tenantId,
        orderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Havale/EFT ödeme bilgileri — müşteri talebiyle tekrar gönderim.
   * bankTransferPendingEmailSentAt güncellenmez (ilk gönderim kaydı korunur).
   */
  async resendBankTransferPaymentPendingEmail(tenantId: string, orderId: string): Promise<boolean> {
    try {
      const [branding, order, bank] = await Promise.all([
        loadTenantBranding(tenantId),
        prisma.order.findFirst({
          where: { id: orderId, tenantId },
          include: {
            customer: { select: { email: true, firstName: true, lastName: true } },
          },
        }),
        tenantPaymentSettingsService.getActiveBankTransferDetails(tenantId),
      ]);

      if (!branding || !order) return false;
      if (resolveOrderPaymentProvider(order) !== 'BANK_TRANSFER') return false;
      if (!bank) return false;

      const email = order.customer?.email?.trim();
      if (!email) return false;

      const orderDate = order.createdAt.toLocaleDateString('tr-TR', {
        year:   'numeric',
        month:  'long',
        day:    'numeric',
        hour:   '2-digit',
        minute: '2-digit',
      });

      await queueStoreTemplate(
        email,
        'STORE_ORDER_BANK_TRANSFER_PENDING',
        {
          ...branding,
          customerName:   customerDisplayName(order.customer.firstName, order.customer.lastName),
          orderNumber:    order.orderNumber,
          orderDate,
          paymentMethod:  paymentMethodLabel('BANK_TRANSFER'),
          grandTotal:     num(order.totalAmount),
          currency:       order.currency,
          bankName:       bank.bankName,
          accountHolder:  bank.accountHolder,
          iban:           bank.iban,
          paymentNote:    bank.description,
          orderDetailUrl: storefrontUrl(
            branding.tenantSlug,
            `/store/hesabim/siparisler/${encodeURIComponent(order.orderNumber)}`,
          ),
          ordersListUrl:  storefrontUrl(
            branding.tenantSlug,
            '/store/hesabim/siparisler',
          ),
          storefrontUrl: storefrontUrl(branding.tenantSlug, '/store'),
        },
        { tenantId, orderId, paymentProvider: 'BANK_TRANSFER', resend: true },
      );

      return true;
    } catch (error) {
      logger.error({
        message: '[StoreEmail] resendBankTransferPaymentPendingEmail failed',
        tenantId,
        orderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Havale/EFT admin ödeme onayı — PENDING → PAID veya PROCESSING (yalnızca bir kez).
   */
  async notifyBankTransferPaymentApproved(
    tenantId: string,
    orderId: string,
    opts?: { newStatus?: string },
  ): Promise<void> {
    try {
      const [branding, order] = await Promise.all([
        loadTenantBranding(tenantId),
        prisma.order.findFirst({
          where: { id: orderId, tenantId },
          include: {
            customer: { select: { email: true, firstName: true, lastName: true } },
          },
        }),
      ]);

      if (!branding || !order) return;

      const paymentProvider = resolveOrderPaymentProvider(order);
      if (paymentProvider !== 'BANK_TRANSFER') {
        logger.warn({
          message: '[StoreEmail] notifyBankTransferPaymentApproved skipped — not BANK_TRANSFER',
          tenantId,
          orderId,
          paymentProvider,
        });
        return;
      }

      if (order.bankTransferApprovedEmailSentAt) {
        logger.warn({
          message: '[StoreEmail] notifyBankTransferPaymentApproved skipped — already sent',
          tenantId,
          orderId,
        });
        return;
      }

      const email = order.customer?.email?.trim();
      if (!email) {
        logger.warn({
          message: '[StoreEmail] notifyBankTransferPaymentApproved skipped — no customer email',
          tenantId,
          orderId,
        });
        return;
      }

      const orderDate = order.createdAt.toLocaleDateString('tr-TR', {
        year:   'numeric',
        month:  'long',
        day:    'numeric',
        hour:   '2-digit',
        minute: '2-digit',
      });

      await queueStoreTemplate(
        email,
        'STORE_ORDER_BANK_TRANSFER_APPROVED',
        {
          ...branding,
          customerName:   customerDisplayName(order.customer.firstName, order.customer.lastName),
          orderNumber:    order.orderNumber,
          orderDate,
          paymentMethod:  paymentMethodLabel('BANK_TRANSFER'),
          grandTotal:     num(order.totalAmount),
          currency:       order.currency,
          orderDetailUrl: storefrontUrl(
            branding.tenantSlug,
            `/store/hesabim/siparisler/${encodeURIComponent(order.orderNumber)}`,
          ),
          storefrontUrl: storefrontUrl(branding.tenantSlug, '/store'),
        },
        { tenantId, orderId, paymentProvider: 'BANK_TRANSFER' },
      );

      const approvedStatus = opts?.newStatus === 'PAID' ? 'PAID' : 'APPROVED';

      await prisma.order.update({
        where: { id: orderId },
        data: {
          bankTransferApprovedEmailSentAt: new Date(),
          paymentStatus:                   approvedStatus,
          paymentApprovedAt:               new Date(),
        },
      });
    } catch (error) {
      logger.error({
        message: '[StoreEmail] notifyBankTransferPaymentApproved failed',
        tenantId,
        orderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Sipariş durumu güncellendi (admin panel vb. notifyCustomer: true çağrıları).
   * PROCESSING, SHIPPED, DELIVERED, CANCELLED — PAID/PENDING hariç.
   */
  async notifyOrderStatusUpdated(
    tenantId: string,
    orderId: string,
    oldStatus: string,
    newStatus: string,
  ): Promise<void> {
    if (!shouldNotifyCustomerOrderStatus(oldStatus, newStatus)) return;

    try {
      const [branding, order] = await Promise.all([
        loadTenantBranding(tenantId),
        prisma.order.findFirst({
          where: { id: orderId, tenantId },
          include: {
            customer: { select: { email: true, firstName: true, lastName: true } },
          },
        }),
      ]);

      if (!branding || !order) return;

      if (newStatus === 'SHIPPED' && order.shippingNotificationSentAt) {
        logger.warn({
          message: '[StoreEmail] notifyOrderStatusUpdated skipped — shipping mail already sent',
          tenantId,
          orderId,
        });
        return;
      }

      const email = order.customer?.email?.trim();
      if (!email) {
        logger.warn({
          message: '[StoreEmail] notifyOrderStatusUpdated skipped — no customer email',
          tenantId,
          orderId,
          newStatus,
        });
        return;
      }

      const copy = orderStatusEmailCopy(newStatus, order.orderNumber);
      const orderDate = order.createdAt.toLocaleDateString('tr-TR', {
        year:  'numeric',
        month: 'long',
        day:   'numeric',
        hour:  '2-digit',
        minute: '2-digit',
      });

      await queueStoreTemplate(
        email,
        'STORE_ORDER_STATUS_UPDATED',
        {
          ...branding,
          customerName:   customerDisplayName(order.customer.firstName, order.customer.lastName),
          orderNumber:    order.orderNumber,
          orderDate,
          newStatus,
          statusLabel:    copy.statusLabel,
          statusHeadline: copy.headline,
          statusMessage:  copy.message,
          grandTotal:     num(order.totalAmount),
          currency:       order.currency,
          orderDetailUrl: storefrontUrl(
            branding.tenantSlug,
            `/store/hesabim/siparisler/${encodeURIComponent(order.orderNumber)}`,
          ),
          storefrontUrl: storefrontUrl(branding.tenantSlug, '/store'),
          shippingCarrier:        order.shippingCarrier,
          shippingTrackingNumber: order.shippingTrackingNumber,
          shippingTrackingUrl:    order.shippingTrackingUrl,
        },
        { tenantId, orderId, oldStatus, newStatus },
      );

      if (newStatus === 'SHIPPED' && !order.shippingNotificationSentAt) {
        await prisma.order.update({
          where: { id: orderId },
          data:  { shippingNotificationSentAt: new Date() },
        });
      }
    } catch (error) {
      logger.error({
        message: '[StoreEmail] notifyOrderStatusUpdated failed',
        tenantId,
        orderId,
        oldStatus,
        newStatus,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /** @deprecated STORE_ORDER_STATUS_UPDATED kullanın */
  async notifyOrderStatusChanged(
    tenantId: string,
    orderId: string,
    oldStatus: string,
    newStatus: string,
  ): Promise<void> {
    return this.notifyOrderStatusUpdated(tenantId, orderId, oldStatus, newStatus);
  }

  async notifyReturnRequestCreated(tenantId: string, requestId: string): Promise<void> {
    try {
      const [branding, request] = await Promise.all([
        loadTenantBranding(tenantId),
        prisma.orderReturnRequest.findFirst({
          where: { id: requestId, tenantId },
          include: {
            customer: { select: { email: true, firstName: true, lastName: true } },
            order:    { select: { orderNumber: true } },
          },
        }),
      ]);

      if (!branding || !request?.customer?.email || !request.order) return;

      await queueStoreTemplate(
        request.customer.email,
        'STORE_RETURN_REQUEST_CREATED',
        {
          ...branding,
          customerName:     customerDisplayName(request.customer.firstName, request.customer.lastName),
          requestNumber:    request.requestNumber,
          orderNumber:      request.order.orderNumber,
          requestType:      request.type,
          statusLabel:      returnStatusLabel('PENDING'),
          requestDetailUrl: storefrontUrl(
            branding.tenantSlug,
            `/store/hesabim/iade-taleplerim/${request.id}`,
          ),
        },
        { tenantId, requestId },
      );
    } catch (error) {
      logger.error({
        message: '[StoreEmail] notifyReturnRequestCreated failed',
        tenantId,
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async notifyReturnRequestStatusChanged(
    tenantId: string,
    requestId: string,
    oldStatus: string,
    newStatus: string,
    adminNote?: string | null,
  ): Promise<void> {
    if (oldStatus === newStatus) return;

    try {
      const [branding, request] = await Promise.all([
        loadTenantBranding(tenantId),
        prisma.orderReturnRequest.findFirst({
          where: { id: requestId, tenantId },
          include: {
            customer: { select: { email: true, firstName: true, lastName: true } },
            order:    { select: { orderNumber: true } },
          },
        }),
      ]);

      if (!branding || !request?.customer?.email || !request.order) return;

      // RETURN_REQUEST + COMPLETED → özel tamamlanma maili ayrı gönderilir
      if (request.type === 'RETURN_REQUEST' && newStatus === 'COMPLETED') {
        await this.notifyReturnCompleted(tenantId, requestId);
        return;
      }

      await queueStoreTemplate(
        request.customer.email,
        'STORE_RETURN_REQUEST_STATUS_CHANGED',
        {
          ...branding,
          customerName:     customerDisplayName(request.customer.firstName, request.customer.lastName),
          requestNumber:    request.requestNumber,
          orderNumber:      request.order.orderNumber,
          newStatusLabel:   returnStatusLabel(newStatus),
          adminNote:        adminNote ?? request.adminNote,
          requestDetailUrl: storefrontUrl(
            branding.tenantSlug,
            `/store/hesabim/iade-taleplerim/${request.id}`,
          ),
        },
        { tenantId, requestId, oldStatus, newStatus },
      );
    } catch (error) {
      logger.error({
        message: '[StoreEmail] notifyReturnRequestStatusChanged failed',
        tenantId,
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async notifyReturnCompleted(tenantId: string, requestId: string): Promise<void> {
    try {
      const [branding, request] = await Promise.all([
        loadTenantBranding(tenantId),
        prisma.orderReturnRequest.findFirst({
          where: { id: requestId, tenantId, type: 'RETURN_REQUEST', status: 'COMPLETED' },
          include: {
            customer: { select: { email: true, firstName: true, lastName: true } },
            order:    { select: { orderNumber: true } },
          },
        }),
      ]);

      if (!branding || !request?.customer?.email || !request.order) return;

      await queueStoreTemplate(
        request.customer.email,
        'STORE_RETURN_COMPLETED',
        {
          ...branding,
          customerName:     customerDisplayName(request.customer.firstName, request.customer.lastName),
          requestNumber:    request.requestNumber,
          orderNumber:      request.order.orderNumber,
          requestDetailUrl: storefrontUrl(
            branding.tenantSlug,
            `/store/hesabim/iade-taleplerim/${request.id}`,
          ),
        },
        { tenantId, requestId },
      );
    } catch (error) {
      logger.error({
        message: '[StoreEmail] notifyReturnCompleted failed',
        tenantId,
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async notifyRefundRecorded(tenantId: string, refundId: string): Promise<void> {
    try {
      const record = await prisma.returnRefundRecord.findFirst({
        where: { id: refundId, tenantId, status: 'RECORDED' },
        include: {
          returnRequest: {
            include: {
              customer: { select: { email: true, firstName: true, lastName: true } },
              order:    { select: { orderNumber: true } },
            },
          },
        },
      });

      if (!record?.returnRequest?.customer?.email) return;

      const branding = await loadTenantBranding(tenantId);
      if (!branding) return;

      await queueStoreTemplate(
        record.returnRequest.customer.email,
        'STORE_REFUND_RECORDED',
        {
          ...branding,
          customerName:     customerDisplayName(
            record.returnRequest.customer.firstName,
            record.returnRequest.customer.lastName,
          ),
          requestNumber:    record.returnRequest.requestNumber,
          orderNumber:      record.returnRequest.order?.orderNumber ?? '—',
          amount:           num(record.amount),
          currency:         record.currency,
          methodLabel:      refundMethodLabel(record.method),
          refundedAt:       record.refundedAt.toLocaleDateString('tr-TR', {
            year:  'numeric',
            month: 'long',
            day:   'numeric',
          }),
          requestDetailUrl: storefrontUrl(
            branding.tenantSlug,
            `/store/hesabim/iade-taleplerim/${record.returnRequestId}`,
          ),
        },
        { tenantId, refundId },
      );
    } catch (error) {
      logger.error({
        message: '[StoreEmail] notifyRefundRecorded failed',
        tenantId,
        refundId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

export const storeEmailService = new StoreEmailService();
