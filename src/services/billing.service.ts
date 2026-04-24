import { PrismaClient, Plan, BillingCycle, SubscriptionStatus, PaymentStatus } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export interface PlanPricing {
  plan: Plan;
  monthly: number;
  yearly: number;
  features: string[];
}

export const PLAN_PRICING: PlanPricing[] = [
  {
    plan: 'STARTER',
    monthly: 99,
    yearly: 990, // 2 months free
    features: [
      '100 Products',
      '1000 Orders/month',
      'Basic Support',
      '1 User',
    ],
  },
  {
    plan: 'PRO',
    monthly: 299,
    yearly: 2990, // 2 months free
    features: [
      'Unlimited Products',
      'Unlimited Orders',
      'Priority Support',
      '5 Users',
      'Advanced Analytics',
      'API Access',
    ],
  },
  {
    plan: 'ENTERPRISE',
    monthly: 999,
    yearly: 9990, // 2 months free
    features: [
      'Everything in Pro',
      'Unlimited Users',
      'Dedicated Support',
      'Custom Integrations',
      'SLA Guarantee',
      'White Label',
    ],
  },
];

export class BillingService {
  /**
   * Get plan pricing
   */
  static getPlanPricing(plan: Plan, billingCycle: BillingCycle): number {
    const pricing = PLAN_PRICING.find(p => p.plan === plan);
    if (!pricing) {
      throw new Error(`Invalid plan: ${plan}`);
    }

    return billingCycle === 'MONTHLY' ? pricing.monthly : pricing.yearly;
  }

  /**
   * Create subscription
   */
  static async createSubscription(data: {
    tenantId: string;
    userId: string;
    plan: Plan;
    billingCycle: BillingCycle;
  }): Promise<any> {
    try {
      const { tenantId, userId, plan, billingCycle } = data;

      // Calculate end date
      const startDate = new Date();
      const endDate = new Date(startDate);
      if (billingCycle === 'MONTHLY') {
        endDate.setMonth(endDate.getMonth() + 1);
      } else {
        endDate.setFullYear(endDate.getFullYear() + 1);
      }

      // Create subscription
      const subscription = await prisma.subscription.create({
        data: {
          tenantId,
          userId,
          plan,
          billingCycle,
          status: 'PENDING',
          startDate,
          endDate,
        },
      });

      logger.info('[Billing] Subscription created', {
        subscriptionId: subscription.id,
        tenantId,
        plan,
        billingCycle,
      });

      return subscription;
    } catch (error) {
      logger.error('[Billing] Error creating subscription', { error });
      throw error;
    }
  }

  /**
   * Create payment
   */
  static async createPayment(data: {
    tenantId: string;
    subscriptionId: string;
    userId: string;
    amount: number;
    currency?: string;
    provider?: string;
  }): Promise<any> {
    try {
      const payment = await prisma.payment.create({
        data: {
          tenantId: data.tenantId,
          subscriptionId: data.subscriptionId,
          userId: data.userId,
          amount: data.amount,
          currency: data.currency || 'TRY',
          provider: data.provider || 'iyzico',
          status: 'PENDING',
        },
      });

      logger.info('[Billing] Payment created', {
        paymentId: payment.id,
        amount: data.amount,
        currency: data.currency,
      });

      return payment;
    } catch (error) {
      logger.error('[Billing] Error creating payment', { error });
      throw error;
    }
  }

  /**
   * Update payment status
   */
  static async updatePaymentStatus(
    paymentId: string,
    status: PaymentStatus,
    transactionId?: string,
    metadata?: any
  ): Promise<void> {
    try {
      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          status,
          transactionId,
          metadata,
        },
      });

      logger.info('[Billing] Payment status updated', {
        paymentId,
        status,
        transactionId,
      });

      // If payment successful, activate subscription
      if (status === 'COMPLETED') {
        const payment = await prisma.payment.findUnique({
          where: { id: paymentId },
          include: { subscription: true },
        });

        if (payment) {
          await this.activateSubscription(payment.subscriptionId);
        }
      }
    } catch (error) {
      logger.error('[Billing] Error updating payment status', { error });
      throw error;
    }
  }

  /**
   * Activate subscription
   */
  static async activateSubscription(subscriptionId: string): Promise<void> {
    try {
      const subscription = await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { status: 'ACTIVE' },
      });

      // Update tenant status
      await prisma.tenant.update({
        where: { id: subscription.tenantId },
        data: { status: 'ACTIVE' },
      });

      // Update user plan
      await prisma.user.update({
        where: { id: subscription.userId },
        data: { plan: subscription.plan },
      });

      logger.info('[Billing] Subscription activated', {
        subscriptionId,
        tenantId: subscription.tenantId,
        plan: subscription.plan,
      });
    } catch (error) {
      logger.error('[Billing] Error activating subscription', { error });
      throw error;
    }
  }

  /**
   * Cancel subscription
   */
  static async cancelSubscription(subscriptionId: string): Promise<void> {
    try {
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          status: 'CANCELED',
          canceledAt: new Date(),
        },
      });

      logger.info('[Billing] Subscription canceled', { subscriptionId });
    } catch (error) {
      logger.error('[Billing] Error canceling subscription', { error });
      throw error;
    }
  }

  /**
   * Get active subscription
   */
  static async getActiveSubscription(tenantId: string): Promise<any> {
    try {
      return await prisma.subscription.findFirst({
        where: {
          tenantId,
          status: 'ACTIVE',
        },
        include: {
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      });
    } catch (error) {
      logger.error('[Billing] Error getting active subscription', { error });
      throw error;
    }
  }

  /**
   * Check subscription expiry
   */
  static async checkExpiredSubscriptions(): Promise<void> {
    try {
      const expiredSubscriptions = await prisma.subscription.findMany({
        where: {
          status: 'ACTIVE',
          endDate: {
            lt: new Date(),
          },
        },
      });

      for (const subscription of expiredSubscriptions) {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'EXPIRED' },
        });

        // Update tenant status
        await prisma.tenant.update({
          where: { id: subscription.tenantId },
          data: { status: 'PAST_DUE' },
        });

        logger.warn('[Billing] Subscription expired', {
          subscriptionId: subscription.id,
          tenantId: subscription.tenantId,
        });
      }

      logger.info('[Billing] Checked expired subscriptions', {
        count: expiredSubscriptions.length,
      });
    } catch (error) {
      logger.error('[Billing] Error checking expired subscriptions', { error });
    }
  }
}

export const billingService = BillingService;
