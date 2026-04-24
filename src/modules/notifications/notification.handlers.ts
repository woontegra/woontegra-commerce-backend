import { NotificationType } from '@prisma/client';
import { eventBus } from './events';
import { emailService }  from './email.service';
import { inAppService }  from './inapp.service';
import { logger }        from '../../config/logger';

// ─── ORDER_CREATED ────────────────────────────────────────────────────────────

eventBus.on('ORDER_CREATED', async (p) => {
  logger.info({ message: '[Event] ORDER_CREATED', orderId: p.orderId });

  await Promise.allSettled([
    // E-mail → customer
    emailService.sendTemplate(p.customerEmail, 'ORDER_CREATED', {
      customerName: p.customerName,
      orderNumber:  p.orderNumber,
      totalAmount:  p.totalAmount,
      currency:     p.currency,
      items:        p.items,
    }),

    // In-app → tenant dashboard
    inAppService.create({
      tenantId: p.tenantId,
      type:     NotificationType.ORDER_CREATED,
      title:    'Yeni Sipariş Alındı',
      message:  `#${p.orderNumber} numaralı sipariş (${p.totalAmount.toFixed(2)} ${p.currency}) oluşturuldu.`,
      data:     { orderId: p.orderId, orderNumber: p.orderNumber, totalAmount: p.totalAmount },
    }),
  ]);
});

// ─── ORDER_STATUS_CHANGED ─────────────────────────────────────────────────────

eventBus.on('ORDER_STATUS_CHANGED', async (p) => {
  logger.info({ message: '[Event] ORDER_STATUS_CHANGED', orderId: p.orderId, newStatus: p.newStatus });

  const statusLabels: Record<string, string> = {
    PROCESSING: 'Hazırlanıyor',
    SHIPPED:    'Kargoya Verildi',
    DELIVERED:  'Teslim Edildi',
    CANCELED:   'İptal Edildi',
  };
  const label = statusLabels[p.newStatus] || p.newStatus;

  await Promise.allSettled([
    inAppService.create({
      tenantId: p.tenantId,
      type:     NotificationType.ORDER_STATUS_CHANGED,
      title:    `Sipariş Durumu: ${label}`,
      message:  `#${p.orderNumber} siparişi ${label} durumuna güncellendi.`,
      data:     { orderId: p.orderId, newStatus: p.newStatus },
    }),
  ]);
});

// ─── PAYMENT_SUCCESS ──────────────────────────────────────────────────────────

eventBus.on('PAYMENT_SUCCESS', async (p) => {
  logger.info({ message: '[Event] PAYMENT_SUCCESS', tenantId: p.tenantId });

  await Promise.allSettled([
    emailService.sendTemplate(p.adminEmail, 'PAYMENT_SUCCESS', {
      tenantName:    p.tenantName,
      plan:          p.plan,
      billingCycle:  p.billingCycle,
      amount:        p.amount,
      currency:      p.currency,
      invoiceNumber: p.invoiceNumber,
    }),

    inAppService.create({
      tenantId: p.tenantId,
      type:     NotificationType.PAYMENT_RECEIVED,
      title:    'Ödeme Alındı',
      message:  `${p.plan} planı için ${p.amount.toFixed(2)} ${p.currency} ödemeniz başarıyla alındı.`,
      data:     { plan: p.plan, amount: p.amount, invoiceNumber: p.invoiceNumber },
    }),
  ]);
});

// ─── PAYMENT_FAILED ───────────────────────────────────────────────────────────

eventBus.on('PAYMENT_FAILED', async (p) => {
  logger.info({ message: '[Event] PAYMENT_FAILED', tenantId: p.tenantId });

  await Promise.allSettled([
    emailService.sendTemplate(p.adminEmail, 'PAYMENT_FAILED', {
      tenantName: p.tenantName,
      plan:       p.plan,
      amount:     p.amount,
      currency:   p.currency,
      reason:     p.reason,
    }),

    inAppService.create({
      tenantId: p.tenantId,
      type:     NotificationType.PAYMENT_FAILED,
      title:    'Ödeme Başarısız',
      message:  `${p.plan} planı için ödeme gerçekleşmedi. Sebep: ${p.reason}`,
      data:     { plan: p.plan, amount: p.amount, reason: p.reason },
    }),
  ]);
});

// ─── SUBSCRIPTION_ACTIVATED ───────────────────────────────────────────────────

eventBus.on('SUBSCRIPTION_ACTIVATED', async (p) => {
  logger.info({ message: '[Event] SUBSCRIPTION_ACTIVATED', tenantId: p.tenantId });

  await Promise.allSettled([
    emailService.sendTemplate(p.adminEmail, 'SUBSCRIPTION_ACTIVATED', {
      tenantName:   p.tenantName,
      plan:         p.plan,
      billingCycle: p.billingCycle,
      endDate:      p.endDate,
    }),

    inAppService.create({
      tenantId: p.tenantId,
      type:     NotificationType.SUBSCRIPTION_ACTIVATED,
      title:    `${p.plan} Planı Aktif`,
      message:  `Aboneliğiniz aktifleşti. Bitiş tarihi: ${p.endDate.toLocaleDateString('tr-TR')}`,
      data:     { plan: p.plan, endDate: p.endDate },
    }),
  ]);
});

// ─── SUBSCRIPTION_CANCELED ────────────────────────────────────────────────────

eventBus.on('SUBSCRIPTION_CANCELED', async (p) => {
  logger.info({ message: '[Event] SUBSCRIPTION_CANCELED', tenantId: p.tenantId });

  await Promise.allSettled([
    emailService.sendTemplate(p.adminEmail, 'SUBSCRIPTION_CANCELED', {
      tenantName: p.tenantName,
      plan:       p.plan,
      endDate:    p.endDate,
    }),

    inAppService.create({
      tenantId: p.tenantId,
      type:     NotificationType.SUBSCRIPTION_CANCELED,
      title:    'Abonelik İptal Edildi',
      message:  `${p.plan} planınız iptal edildi. ${p.endDate.toLocaleDateString('tr-TR')} tarihine kadar aktif.`,
      data:     { plan: p.plan, endDate: p.endDate },
    }),
  ]);
});

// ─── TRIAL_ENDING_SOON ────────────────────────────────────────────────────────

eventBus.on('TRIAL_ENDING_SOON', async (p) => {
  logger.info({ message: '[Event] TRIAL_ENDING_SOON', tenantId: p.tenantId, daysLeft: p.daysLeft });

  await Promise.allSettled([
    emailService.sendTemplate(p.adminEmail, 'TRIAL_ENDING_SOON', {
      tenantName:  p.tenantName,
      daysLeft:    p.daysLeft,
      trialEndsAt: p.trialEndsAt,
    }),

    inAppService.create({
      tenantId: p.tenantId,
      type:     NotificationType.TRIAL_ENDING_SOON,
      title:    `Deneme Süreniz Bitiyor (${p.daysLeft} Gün)`,
      message:  `Deneme sürenizin bitmesine ${p.daysLeft} gün kaldı. Kesintisiz devam etmek için plan seçin.`,
      data:     { daysLeft: p.daysLeft, trialEndsAt: p.trialEndsAt },
    }),
  ]);
});

// ─── TRIAL_EXPIRED ────────────────────────────────────────────────────────────

eventBus.on('TRIAL_EXPIRED', async (p) => {
  logger.info({ message: '[Event] TRIAL_EXPIRED', tenantId: p.tenantId });

  await Promise.allSettled([
    emailService.sendTemplate(p.adminEmail, 'TRIAL_EXPIRED', {
      tenantName: p.tenantName,
    }),

    inAppService.create({
      tenantId: p.tenantId,
      type:     NotificationType.TRIAL_EXPIRED,
      title:    'Deneme Süreniz Doldu',
      message:  'Woontegra kullanımınızı sürdürmek için bir plan seçin.',
      data:     {},
    }),
  ]);
});

// ─── STOCK_LOW ────────────────────────────────────────────────────────────────

eventBus.on('STOCK_LOW', async (p) => {
  logger.info({ message: '[Event] STOCK_LOW', productId: p.productId });

  await inAppService.create({
    tenantId: p.tenantId,
    type:     NotificationType.STOCK_LOW,
    title:    'Düşük Stok Uyarısı',
    message:  `${p.productName} ürününde stok kritik seviyeye düştü (${p.currentQty} adet kaldı).`,
    data:     { productId: p.productId, productName: p.productName, currentQty: p.currentQty, threshold: p.threshold },
  });
});

// ─── TENANT_SUSPENDED ─────────────────────────────────────────────────────────

eventBus.on('TENANT_SUSPENDED', async (p) => {
  logger.info({ message: '[Event] TENANT_SUSPENDED', tenantId: p.tenantId });

  await inAppService.create({
    tenantId: p.tenantId,
    type:     NotificationType.TENANT_SUSPENDED,
    title:    'Hesabınız Askıya Alındı',
    message:  p.reason
      ? `Hesabınız şu sebeple askıya alındı: ${p.reason}. Destek için iletişime geçin.`
      : 'Hesabınız askıya alındı. Destek için iletişime geçin.',
    data: { reason: p.reason },
  });
});

// ─── USER_BANNED ──────────────────────────────────────────────────────────────

eventBus.on('USER_BANNED', async (p) => {
  logger.info({ message: '[Event] USER_BANNED', userId: p.userId });

  await inAppService.create({
    tenantId: p.tenantId,
    type:     NotificationType.USER_BANNED,
    title:    'Kullanıcı Engellendi',
    message:  `${p.userEmail} kullanıcısı engellendi.`,
    data:     { userId: p.userId, userEmail: p.userEmail, reason: p.reason },
  });
});

logger.info({ message: '[Notifications] All event handlers registered' });
