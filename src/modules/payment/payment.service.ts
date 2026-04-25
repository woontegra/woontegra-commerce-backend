import { PrismaClient, PaymentStatus, BillingCycle, Plan, SubscriptionStatus } from '@prisma/client';
import { AppError } from '../../common/middleware/error.middleware';
import Stripe from 'stripe';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20' as any,
});

// PaymentMethod as string type since it's not defined as enum in schema
type PaymentMethodType = 'credit_card' | 'bank_transfer' | 'paypal' | 'iyzico';

interface PaymentRequest {
  tenantId: string;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethodType;
  description?: string;
  metadata?: Record<string, any>;
}

interface SubscriptionRequest {
  tenantId: string;
  userId: string;
  plan: Plan;
  paymentData: PaymentRequest;
  billingCycle: BillingCycle;
}

export class PaymentService {
  // Process payment
  static async processPayment(userId: string, data: PaymentRequest) {
    try {
      let paymentResult;

      switch (data.paymentMethod) {
        case 'credit_card':
          paymentResult = await this.processStripePayment(data);
          break;
        case 'bank_transfer':
          paymentResult = await this.processBankTransfer(data);
          break;
        case 'paypal':
          paymentResult = await this.processPayPalPayment(data);
          break;
        case 'iyzico':
          paymentResult = await this.processIyzicoPayment(data);
          break;
        default:
          throw new AppError('Unsupported payment method', 400);
      }

      // Save payment record
      const payment = await prisma.payment.create({
        data: {
          tenantId: data.tenantId,
          subscriptionId: '', // Will be updated after subscription creation
          amount: data.amount,
          currency: data.currency,
          status: paymentResult.status as PaymentStatus,
          method: data.paymentMethod,
          externalId: paymentResult.externalId,
          description: data.description,
          metadata: data.metadata || {},
        },
      });

      logger.info(`Payment processed: ${payment.id}`, { userId, amount: data.amount });

      return {
        success: true,
        payment,
        transactionId: paymentResult.externalId,
      };
    } catch (error) {
      logger.error('Payment processing failed:', error);
      throw new AppError('Payment processing failed', 500);
    }
  }

  // Process Stripe payment
  private static async processStripePayment(data: PaymentRequest) {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(data.amount * 100), // Convert to cents
        currency: data.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        description: data.description,
        metadata: data.metadata,
      });

      return {
        status: 'pending' as PaymentStatus,
        externalId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
      };
    } catch (error) {
      logger.error('Stripe payment failed:', error);
      throw new AppError('Stripe payment failed', 500);
    }
  }

  // Process bank transfer
  private static async processBankTransfer(data: PaymentRequest) {
    const referenceNumber = `TRF-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    return {
      status: 'pending' as PaymentStatus,
      externalId: referenceNumber,
      instructions: `Please transfer ${data.amount} ${data.currency} to our bank account with reference: ${referenceNumber}`,
    };
  }

  // Process PayPal payment
  private static async processPayPalPayment(data: PaymentRequest) {
    const paypalOrderId = `PAYPAL-${Date.now()}`;

    return {
      status: 'pending' as PaymentStatus,
      externalId: paypalOrderId,
      redirectUrl: `https://www.paypal.com/checkout?token=${paypalOrderId}`,
    };
  }

  // Process Iyzico payment
  private static async processIyzicoPayment(data: PaymentRequest) {
    const iyzicoTransactionId = `IYZICO-${Date.now()}`;

    return {
      status: 'pending' as PaymentStatus,
      externalId: iyzicoTransactionId,
    };
  }

  // Create subscription
  static async createSubscription(data: SubscriptionRequest) {
    try {
      const { tenantId, userId, plan, paymentData, billingCycle } = data;

      // Calculate price based on plan and billing cycle
      const planPricing = this.getPlanPricing(plan, billingCycle);

      // Process initial payment
      const paymentResult = await this.processPayment(userId, {
        ...paymentData,
        tenantId,
        amount: planPricing,
        description: `Subscription: ${plan} (${billingCycle})`,
        metadata: {
          plan,
          billingCycle,
          type: 'subscription',
        },
      });

      if (!paymentResult.success) {
        throw new AppError('Payment failed', 400);
      }

      // Create subscription
      const now = new Date();
      const endDate = new Date(now);
      if (billingCycle === 'YEARLY') {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }

      // Update payment with proper subscription ID (will be created first)
      const subscription = await prisma.subscription.create({
        data: {
          tenantId,
          userId,
          plan,
          status: 'active' as SubscriptionStatus,
          billingCycle,
          price: planPricing,
          currency: paymentData.currency,
          startDate: now,
          endDate,
          paymentId: paymentResult.payment.id,
          nextBillingDate: endDate,
        },
      });

      // Update payment with subscription ID
      await prisma.payment.update({
        where: { id: paymentResult.payment.id },
        data: { subscriptionId: subscription.id },
      });

      logger.info(`Subscription created: ${subscription.id}`, { userId, plan, tenantId });

      return {
        success: true,
        subscription,
        payment: paymentResult.payment,
      };
    } catch (error) {
      logger.error('Subscription creation failed:', error);
      throw error;
    }
  }

  // Cancel subscription
  static async cancelSubscription(userId: string, subscriptionId: string) {
    try {
      const subscription = await prisma.subscription.findFirst({
        where: { id: subscriptionId, userId },
      });

      if (!subscription) {
        throw new AppError('Subscription not found', 404);
      }

      if (subscription.status !== 'active') {
        throw new AppError('Subscription is not active', 400);
      }

      const updatedSubscription = await prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          status: 'cancelled' as SubscriptionStatus,
          cancelledAt: new Date(),
        },
      });

      logger.info(`Subscription cancelled: ${subscriptionId}`, { userId });

      return {
        success: true,
        subscription: updatedSubscription,
      };
    } catch (error) {
      logger.error('Subscription cancellation failed:', error);
      throw error;
    }
  }

  // Get payment history
  static async getPaymentHistory(userId: string, options: { limit?: number; offset?: number } = {}) {
    try {
      const { limit = 10, offset = 0 } = options;

      // Get user to find tenant
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { tenantId: true },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where: { tenantId: user.tenantId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            subscription: true,
          },
        }),
        prisma.payment.count({ where: { tenantId: user.tenantId } }),
      ]);

      return {
        success: true,
        payments,
        total,
        limit,
        offset,
      };
    } catch (error) {
      logger.error('Get payment history failed:', error);
      throw new AppError('Failed to get payment history', 500);
    }
  }

  // Get billing history
  static async getBillingHistory(userId: string) {
    try {
      // Get user to find tenant
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { tenantId: true },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const subscriptions = await prisma.subscription.findMany({
        where: {
          userId,
        },
        include: {
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const invoices = await prisma.invoice.findMany({
        where: {
          tenantId: user.tenantId,
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        subscriptions,
        invoices,
      };
    } catch (error) {
      logger.error('Get billing history failed:', error);
      throw new AppError('Failed to get billing history', 500);
    }
  }

  // Upgrade plan
  static async upgradePlan(userId: string, newPlan: Plan, paymentData: PaymentRequest) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { tenantId: true },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const currentSubscription = await prisma.subscription.findFirst({
        where: {
          userId,
          status: 'active',
        },
      });

      if (!currentSubscription) {
        throw new AppError('No active subscription found', 400);
      }

      // Calculate new price
      const newPlanPrice = this.getPlanPricing(newPlan, currentSubscription.billingCycle);

      // Calculate prorated amount
      const now = new Date();
      const daysRemaining = Math.max(0, Math.ceil((currentSubscription.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      const totalDays = currentSubscription.billingCycle === 'YEARLY' ? 365 : 30;
      const dailyRate = currentSubscription.price / totalDays;
      const remainingValue = dailyRate * daysRemaining;

      const upgradeCost = Math.max(0, newPlanPrice - remainingValue);

      // Process upgrade payment
      const paymentResult = await this.processPayment(userId, {
        ...paymentData,
        tenantId: user.tenantId,
        amount: upgradeCost,
        description: `Plan upgrade: ${currentSubscription.plan} → ${newPlan}`,
        metadata: {
          type: 'upgrade',
          fromPlan: currentSubscription.plan,
          toPlan: newPlan,
          proratedCredit: remainingValue,
        },
      });

      if (!paymentResult.success) {
        throw new AppError('Upgrade payment failed', 400);
      }

      // Cancel current subscription
      await prisma.subscription.update({
        where: { id: currentSubscription.id },
        data: {
          status: 'cancelled' as SubscriptionStatus,
          cancelledAt: now,
        },
      });

      // Create new subscription
      const endDate = new Date(now);
      if (currentSubscription.billingCycle === 'YEARLY') {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }

      const newSubscription = await prisma.subscription.create({
        data: {
          tenantId: user.tenantId,
          userId,
          plan: newPlan,
          status: 'active' as SubscriptionStatus,
          billingCycle: currentSubscription.billingCycle,
          price: newPlanPrice,
          currency: currentSubscription.currency,
          startDate: now,
          endDate,
          paymentId: paymentResult.payment.id,
          nextBillingDate: endDate,
        },
      });

      // Update payment with subscription ID
      await prisma.payment.update({
        where: { id: paymentResult.payment.id },
        data: { subscriptionId: newSubscription.id },
      });

      logger.info(`Plan upgraded: ${userId} → ${newPlan}`, { userId, newPlan, tenantId: user.tenantId });

      return {
        success: true,
        subscription: newSubscription,
        payment: paymentResult.payment,
        previousSubscription: currentSubscription,
      };
    } catch (error) {
      logger.error('Plan upgrade failed:', error);
      throw error;
    }
  }

  // Helper to get plan pricing
  private static getPlanPricing(plan: Plan, billingCycle: BillingCycle): number {
    const prices: Record<Plan, { monthly: number; yearly: number }> = {
      STARTER: { monthly: 99, yearly: 990 },
      PRO: { monthly: 299, yearly: 2990 },
      ENTERPRISE: { monthly: 999, yearly: 9990 },
    };

    return billingCycle === 'YEARLY' ? prices[plan].yearly : prices[plan].monthly;
  }

  // Webhook handler for Stripe
  static async handleStripeWebhook(payload: any, signature: string) {
    try {
      const event = stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET || ''
      );

      logger.info(`Stripe webhook received: ${event.type}`, { eventId: event.id });

      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentSuccess(event.data.object);
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentFailure(event.data.object);
          break;
        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSuccess(event.data.object);
          break;
        default:
          logger.info(`Unhandled Stripe event: ${event.type}`);
      }

      return { received: true };
    } catch (error) {
      logger.error('Stripe webhook handling failed:', error);
      throw new AppError('Webhook handling failed', 400);
    }
  }

  private static async handlePaymentSuccess(paymentIntent: any) {
    await prisma.payment.updateMany({
      where: { externalId: paymentIntent.id },
      data: { status: 'completed' as PaymentStatus },
    });
  }

  private static async handlePaymentFailure(paymentIntent: any) {
    await prisma.payment.updateMany({
      where: { externalId: paymentIntent.id },
      data: { status: 'failed' as PaymentStatus },
    });
  }

  private static async handleInvoicePaymentSuccess(invoice: any) {
    logger.info(`Invoice payment succeeded: ${invoice.id}`);
  }
}

export default PaymentService;
