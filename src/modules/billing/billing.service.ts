import Iyzipay from 'iyzipay';
import crypto from 'crypto';
import { PrismaClient, Plan, SubscriptionStatus, PaymentStatus, BillingCycle } from '@prisma/client';
import { logger } from '../../config/logger';
import { InvoiceService } from './invoice.service';
import { eventBus } from '../notifications/events';
import { auditService, AuditCategory, AuditAction } from '../audit/audit.service';

const invoiceService = new InvoiceService();

const prisma = new PrismaClient();

// ─── Plan pricing (TRY) ───────────────────────────────────────────────────────
export const PLAN_PRICES_TRY: Record<string, Record<string, number>> = {
  STARTER:    { MONTHLY: 0,    YEARLY: 0 },
  PRO:        { MONTHLY: 599,  YEARLY: 5990 },
  ENTERPRISE: { MONTHLY: 1299, YEARLY: 12990 },
};

// ─── iyzico client factory ────────────────────────────────────────────────────
function buildIyzicoClient(): Iyzipay {
  const apiKey    = process.env.IYZICO_API_KEY;
  const secretKey = process.env.IYZICO_SECRET_KEY;
  const uri       = process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com';

  if (!apiKey || !secretKey) {
    throw new Error('IYZICO_API_KEY and IYZICO_SECRET_KEY must be set in environment');
  }

  return new Iyzipay({ apiKey, secretKey, uri });
}

// ─── BillingService ───────────────────────────────────────────────────────────
export class BillingService {

  // ── 1. Init payment: create iyzico checkout form ──────────────────────────
  async initPayment(
    userId: string,
    tenantId: string,
    plan: Plan,
    billingCycle: BillingCycle,
    buyerIp: string,
  ): Promise<{ checkoutFormContent: string; token: string; paymentId: string }> {

    if (plan === Plan.STARTER) {
      throw new Error('STARTER planı ücretsizdir, ödeme gerekmez.');
    }

    const priceAmount = PLAN_PRICES_TRY[plan]?.[billingCycle];
    if (!priceAmount) {
      throw new Error('Geçersiz plan veya fatura döngüsü.');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true },
    });
    if (!user) throw new Error('Kullanıcı bulunamadı.');

    // Clean up stale pending payments/subscriptions for this tenant
    const stalePending = await prisma.subscription.findMany({
      where: { tenantId, status: SubscriptionStatus.PENDING },
      include: { payments: true },
    });
    for (const s of stalePending) {
      await prisma.payment.updateMany({
        where: { subscriptionId: s.id, status: PaymentStatus.PENDING },
        data:  { status: PaymentStatus.FAILED },
      });
      await prisma.subscription.update({
        where: { id: s.id },
        data:  { status: SubscriptionStatus.CANCELED },
      });
    }

    // Calculate subscription end date
    const startDate = new Date();
    const endDate   = billingCycle === BillingCycle.MONTHLY
      ? new Date(new Date().setMonth(new Date().getMonth() + 1))
      : new Date(new Date().setFullYear(new Date().getFullYear() + 1));

    // Create PENDING subscription
    const subscription = await prisma.subscription.create({
      data: { tenantId, userId, plan, billingCycle, status: SubscriptionStatus.PENDING, startDate, endDate },
    });

    const conversationId = `wt_${tenantId.slice(0, 8)}_${Date.now()}`;

    // Create PENDING payment
    const payment = await prisma.payment.create({
      data: {
        tenantId,
        subscriptionId: subscription.id,
        userId,
        amount:   priceAmount,
        currency: 'TRY',
        status:   PaymentStatus.PENDING,
        provider: 'iyzico',
        metadata: { conversationId, plan, billingCycle },
      },
    });

    // Create OPEN invoice for this payment
    await invoiceService.createSubscriptionInvoice(
      tenantId, subscription.id, plan, billingCycle,
      priceAmount, startDate, endDate,
    );

    // ── Audit: payment initiated ───────────────────────────────────────────────
    await auditService.log({
      userId: userId, tenantId,
      action: AuditAction.PAYMENT_INITIATED, category: AuditCategory.BILLING,
      targetType: 'Payment', targetId: payment.id,
      details: { plan, billingCycle, amount: priceAmount, currency: 'TRY', subscriptionId: subscription.id },
    });

    const callbackUrl = `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/billing/payment/callback`;

    const iyzipay = buildIyzicoClient();

    return new Promise((resolve, reject) => {
      const request = {
        locale:              Iyzipay.LOCALE.TR,
        conversationId,
        price:               priceAmount.toFixed(2),
        paidPrice:           priceAmount.toFixed(2),
        currency:            Iyzipay.CURRENCY.TRY,
        basketId:            payment.id,
        paymentGroup:        Iyzipay.PAYMENT_GROUP.SUBSCRIPTION,
        callbackUrl,
        enabledInstallments: ['1', '2', '3', '6', '9', '12'],
        buyer: {
          id:                  userId,
          name:                user.firstName,
          surname:             user.lastName,
          gsmNumber:           '+905350000000',
          email:               user.email,
          identityNumber:      '11111111111',
          registrationAddress: 'N/A',
          ip:                  buyerIp || '127.0.0.1',
          city:                'Istanbul',
          country:             'Turkey',
          zipCode:             '34000',
        },
        shippingAddress: {
          contactName: `${user.firstName} ${user.lastName}`,
          city:        'Istanbul',
          country:     'Turkey',
          address:     'N/A',
          zipCode:     '34000',
        },
        billingAddress: {
          contactName: `${user.firstName} ${user.lastName}`,
          city:        'Istanbul',
          country:     'Turkey',
          address:     'N/A',
          zipCode:     '34000',
        },
        basketItems: [
          {
            id:        payment.id,
            name:      `${plan} Plan - ${billingCycle === BillingCycle.MONTHLY ? 'Aylık' : 'Yıllık'}`,
            category1: 'SaaS Abonelik',
            itemType:  Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
            price:     priceAmount.toFixed(2),
          },
        ],
      };

      iyzipay.checkoutFormInitialize.create(request, async (err: any, result: any) => {
        if (err || result.status !== 'success') {
          const errMsg = err?.message || result?.errorMessage || 'iyzico checkout başlatılamadı.';
          logger.error({ message: 'iyzico init failed', error: errMsg, paymentId: payment.id });

          await prisma.payment.update({
            where: { id: payment.id },
            data:  { status: PaymentStatus.FAILED, metadata: { conversationId, error: errMsg } },
          });
          await prisma.subscription.update({
            where: { id: subscription.id },
            data:  { status: SubscriptionStatus.CANCELED },
          });
          return reject(new Error(errMsg));
        }

        // Store iyzico token so callback can look it up
        await prisma.payment.update({
          where: { id: payment.id },
          data:  { iyzicoToken: result.token },
        });

        logger.info({ message: 'iyzico checkout created', paymentId: payment.id, token: result.token });

        resolve({
          checkoutFormContent: result.checkoutFormContent,
          token:               result.token,
          paymentId:           payment.id,
        });
      });
    });
  }

  // ── 2. Handle iyzico callback ──────────────────────────────────────────────
  async handleCallback(token: string): Promise<{ status: 'success' | 'failed'; redirectUrl: string }> {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (!token) {
      return { status: 'failed', redirectUrl: `${frontendUrl}/payment-result?status=failed&reason=missing_token` };
    }

    const payment = await prisma.payment.findUnique({
      where:   { iyzicoToken: token },
      include: { subscription: true },
    });

    if (!payment) {
      logger.warn({ message: 'Callback: payment not found', token });
      return { status: 'failed', redirectUrl: `${frontendUrl}/payment-result?status=failed&reason=not_found` };
    }

    // Prevent double-processing
    if (payment.status === PaymentStatus.SUCCESS) {
      return { status: 'success', redirectUrl: `${frontendUrl}/payment-result?status=success&plan=${payment.subscription.plan}` };
    }

    const iyzipay    = buildIyzicoClient();
    const conversationId = (payment.metadata as any)?.conversationId || '';

    return new Promise((resolve) => {
      iyzipay.checkoutFormRetrieve.retrieve(
        { locale: Iyzipay.LOCALE.TR, conversationId, token },
        async (err: any, result: any) => {
          if (err || result.status !== 'success' || result.paymentStatus !== 'SUCCESS') {
            const reason = result?.errorMessage || result?.paymentStatus || err?.message || 'payment_failed';
            logger.error({ message: 'iyzico payment failed', token, reason });

            await prisma.payment.update({
              where: { id: payment.id },
              data:  {
                status:   PaymentStatus.FAILED,
                metadata: { ...(payment.metadata as any), iyzicoResult: result, error: reason },
              },
            });
            await prisma.subscription.update({
              where: { id: payment.subscriptionId },
              data:  { status: SubscriptionStatus.CANCELED },
            });

            // ── Lifecycle: payment failed → PAST_DUE ─────────────────────
            const failedTenant = await prisma.tenant.update({
              where: { id: payment.tenantId },
              data:  { status: 'PAST_DUE' },
              include: { users: { take: 1, where: { role: 'ADMIN' } } },
            });

            // ── Audit: payment failed ─────────────────────────────────────
            await auditService.log({
              userId: payment.userId, tenantId: payment.tenantId,
              action: AuditAction.PAYMENT_FAILED, category: AuditCategory.BILLING,
              targetType: 'Payment', targetId: payment.id,
              status: 'FAILURE', errorMsg: reason,
              details: { subscriptionId: payment.subscriptionId, amount: Number(payment.amount), reason },
            });

            // ── Event: PAYMENT_FAILED ──────────────────────────────────────
            const failAdminEmail = failedTenant.users[0]?.email || '';
            if (failAdminEmail) {
              eventBus.emit('PAYMENT_FAILED', {
                tenantId:   payment.tenantId,
                tenantName: failedTenant.name,
                plan:       (payment.metadata as any)?.plan || 'PRO',
                amount:     Number(payment.amount),
                currency:   payment.currency,
                reason,
                adminEmail: failAdminEmail,
              });
            }

            return resolve({
              status:      'failed',
              redirectUrl: `${frontendUrl}/payment-result?status=failed&reason=${encodeURIComponent(reason)}`,
            });
          }

          try {
            // Deactivate any existing active subscriptions for this tenant
            await prisma.subscription.updateMany({
              where: {
                tenantId: payment.tenantId,
                status:   SubscriptionStatus.ACTIVE,
                id:       { not: payment.subscriptionId },
              },
              data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
            });

            // Activate new subscription
            const now = new Date();
            await prisma.subscription.update({
              where: { id: payment.subscriptionId },
              data:  { status: SubscriptionStatus.ACTIVE, startDate: now },
            });

            // Record successful payment
            await prisma.payment.update({
              where: { id: payment.id },
              data:  {
                status:        PaymentStatus.SUCCESS,
                transactionId: result.paymentId?.toString(),
                metadata:      { ...(payment.metadata as any), iyzicoResult: result },
              },
            });

            // ── Lifecycle: activate tenant ────────────────────────────────
            const activatedTenant = await prisma.tenant.update({
              where:   { id: payment.tenantId },
              data:    { status: 'ACTIVE', suspendedAt: null },
              include: { users: { take: 1, where: { role: 'ADMIN' } } },
            });

            // ── Get activated subscription first ───────────────────────────
            const activatedSub = payment.subscription;
            const adminEmail = activatedTenant.users[0]?.email || '';

            // ── Audit: payment success + subscription activated ────────────
            await auditService.log({
              userId: payment.userId, tenantId: payment.tenantId,
              action: AuditAction.PAYMENT_SUCCESS, category: AuditCategory.BILLING,
              targetType: 'Payment', targetId: payment.id,
              details: {
                subscriptionId: payment.subscriptionId,
                plan:           activatedSub.plan,
                amount:         Number(payment.amount),
                transactionId:  result.paymentId,
              },
            });
            await auditService.log({
              userId: payment.userId, tenantId: payment.tenantId,
              action: AuditAction.SUBSCRIPTION_ACTIVATED, category: AuditCategory.BILLING,
              targetType: 'Subscription', targetId: payment.subscriptionId,
              details: { plan: activatedSub.plan, billingCycle: activatedSub.billingCycle, endDate: activatedSub.endDate },
            });

            // ── Event: SUBSCRIPTION_ACTIVATED + PAYMENT_SUCCESS ───────────
            if (adminEmail) {
              eventBus.emit('PAYMENT_SUCCESS', {
                tenantId:      payment.tenantId,
                tenantName:    activatedTenant.name,
                plan:          activatedSub.plan,
                billingCycle:  activatedSub.billingCycle,
                amount:        Number(payment.amount),
                currency:      payment.currency,
                adminEmail,
              });
              eventBus.emit('SUBSCRIPTION_ACTIVATED', {
                tenantId:     payment.tenantId,
                tenantName:   activatedTenant.name,
                plan:         activatedSub.plan,
                billingCycle: activatedSub.billingCycle,
                endDate:      activatedSub.endDate,
                adminEmail,
              });
            }

            // ── Mark subscription invoice as PAID ─────────────────────────
            await invoiceService.markInvoicePaidBySubscription(
              payment.subscriptionId,
              payment.id,
            );

            // Sync User.plan for backward compatibility with existing middleware
            await prisma.user.update({
              where: { id: payment.userId },
              data:  { plan: payment.subscription.plan },
            });

            // Also sync all other users in the tenant (tenant-wide plan)
            await prisma.user.updateMany({
              where: { tenantId: payment.tenantId },
              data:  { plan: payment.subscription.plan },
            });

            logger.info({
              message:       'Subscription activated',
              subscriptionId: payment.subscriptionId,
              tenantId:       payment.tenantId,
              plan:           payment.subscription.plan,
            });

            resolve({
              status:      'success',
              redirectUrl: `${frontendUrl}/payment-result?status=success&plan=${payment.subscription.plan}`,
            });
          } catch (dbErr: any) {
            logger.error({ message: 'DB error after successful payment', error: dbErr?.message });
            resolve({
              status:      'failed',
              redirectUrl: `${frontendUrl}/payment-result?status=failed&reason=db_error`,
            });
          }
        },
      );
    });
  }

  // ── 3. Webhook handler ────────────────────────────────────────────────────
  async handleWebhook(rawBody: string, iyzicoSignature: string | undefined): Promise<void> {
    const secretKey = process.env.IYZICO_SECRET_KEY;
    if (!secretKey) throw new Error('IYZICO_SECRET_KEY not configured');

    // Verify HMAC-SHA1 signature (iyzico uses SHA1)
    if (iyzicoSignature) {
      const expected = crypto
        .createHmac('sha1', secretKey)
        .update(rawBody)
        .digest('base64');

      if (expected !== iyzicoSignature) {
        logger.warn({ message: 'iyzico webhook signature mismatch' });
        throw new Error('Invalid webhook signature');
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new Error('Invalid webhook payload');
    }

    logger.info({ message: 'iyzico webhook received', payload });

    const { iyzicoPaymentId, status } = payload;

    if (!iyzicoPaymentId) return;

    const payment = await prisma.payment.findFirst({
      where:   { transactionId: iyzicoPaymentId.toString() },
      include: { subscription: true },
    });

    if (!payment) return;

    if (status === 'SUCCESS' && payment.status !== PaymentStatus.SUCCESS) {
      await prisma.payment.update({
        where: { id: payment.id },
        data:  { status: PaymentStatus.SUCCESS },
      });
      await prisma.subscription.update({
        where: { id: payment.subscriptionId },
        data:  { status: SubscriptionStatus.ACTIVE },
      });
    } else if (status === 'FAILURE') {
      await prisma.payment.update({
        where: { id: payment.id },
        data:  { status: PaymentStatus.FAILED },
      });
      if (payment.subscription.status === SubscriptionStatus.PENDING) {
        await prisma.subscription.update({
          where: { id: payment.subscriptionId },
          data:  { status: SubscriptionStatus.CANCELED },
        });
      }
    }
  }

  // ── 4. Get current subscription ───────────────────────────────────────────
  async getCurrentSubscription(tenantId: string) {
    return prisma.subscription.findFirst({
      where: {
        tenantId,
        status:  { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELED] },
        endDate: { gte: new Date() },
      },
      include: {
        payments: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── 5. Cancel subscription ────────────────────────────────────────────────
  async cancelSubscription(tenantId: string, canceledByUserId?: string): Promise<void> {
    const subscription = await prisma.subscription.findFirst({
      where: {
        tenantId,
        status:  SubscriptionStatus.ACTIVE,
        endDate: { gte: new Date() },
      },
    });

    if (!subscription) {
      throw new Error('Aktif abonelik bulunamadı.');
    }

    await prisma.subscription.update({
      where: { id: subscription.id },
      data:  { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
    });

    await auditService.log({
      userId:   canceledByUserId ?? undefined,
      tenantId,
      action:   AuditAction.SUBSCRIPTION_CANCELED,
      category: AuditCategory.BILLING,
      targetType: 'Subscription', targetId: subscription.id,
      details: { plan: subscription.plan, billingCycle: subscription.billingCycle },
    });

    logger.info({ message: 'Subscription canceled', subscriptionId: subscription.id, tenantId });
  }

  // ── 6. Billing history ────────────────────────────────────────────────────
  async getBillingHistory(tenantId: string) {
    return prisma.payment.findMany({
      where:   { tenantId },
      include: { subscription: { select: { plan: true, billingCycle: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── 7. Check and expire outdated subscriptions ────────────────────────────
  async expireStaleSubscriptions(): Promise<void> {
    await prisma.subscription.updateMany({
      where: {
        endDate: { lt: new Date() },
        status:  { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELED] },
      },
      data: { status: SubscriptionStatus.EXPIRED },
    });

    // Reset plan to STARTER for expired tenants
    const expiredSubs = await prisma.subscription.findMany({
      where:  { status: SubscriptionStatus.EXPIRED },
      select: { tenantId: true },
    });
    const tenantIds = [...new Set(expiredSubs.map((s) => s.tenantId))];

    for (const tid of tenantIds) {
      // Only reset if no other active subscription
      const hasActive = await prisma.subscription.findFirst({
        where: { tenantId: tid, status: SubscriptionStatus.ACTIVE, endDate: { gte: new Date() } },
      });
      if (!hasActive) {
        await prisma.user.updateMany({
          where: { tenantId: tid },
          data:  { plan: Plan.STARTER },
        });
      }
    }
  }
}
