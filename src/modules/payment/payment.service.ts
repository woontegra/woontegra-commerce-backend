import { PrismaClient, PaymentStatus, PaymentMethod, SubscriptionPlan } from '@prisma/client';
import { AppError } from '../../common/middleware/error.middleware';
import Stripe from 'stripe';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20' as any,
});

interface PaymentRequest {
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  description?: string;
  metadata?: Record<string, any>;
}

interface SubscriptionRequest {
  planId: string;
  paymentData: PaymentRequest;
  billingCycle: 'monthly' | 'yearly';
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
        default:
          throw new AppError('Unsupported payment method', 400);
      }

      // Save payment record
      const payment = await prisma.payment.create({
        data: {
          userId,
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
        status: 'pending',
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
    // Bank transfer logic - generate reference number
    const referenceNumber = `TRF-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    return {
      status: 'pending',
      externalId: referenceNumber,
      instructions: `Please transfer ${data.amount} ${data.currency} to our bank account with reference: ${referenceNumber}`,
    };
  }

  // Process PayPal payment
  private static async processPayPalPayment(data: PaymentRequest) {
    // PayPal integration placeholder
    const paypalOrderId = `PAYPAL-${Date.now()}`;

    return {
      status: 'pending',
      externalId: paypalOrderId,
      redirectUrl: `https://www.paypal.com/checkout?token=${paypalOrderId}`,
    };
  }

  // Create subscription
  static async createSubscription(userId: string, data: SubscriptionRequest) {
    try {
      const plan = await prisma.subscriptionPlan.findUnique({
        where: { id: data.planId },
      });

      if (!plan) {
        throw new AppError('Subscription plan not found', 404);
      }

      // Calculate price based on billing cycle
      const price = data.billingCycle === 'yearly'
        ? (plan.yearlyPrice || plan.monthlyPrice * 10)
        : plan.monthlyPrice;

      // Process initial payment
      const paymentResult = await this.processPayment(userId, {
        ...data.paymentData,
        amount: price,
        description: `Subscription: ${plan.name} (${data.billingCycle})`,
        metadata: {
          planId: plan.id,
          billingCycle: data.billingCycle,
          type: 'subscription',
        },
      });

      if (!paymentResult.success) {
        throw new AppError('Payment failed', 400);
      }

      // Create subscription
      const now = new Date();
      const endDate = new Date(now);
      if (data.billingCycle === 'yearly') {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }

      const subscription = await prisma.userSubscription.create({
        data: {
          userId,
          planId: plan.id,
          status: 'active',
          billingCycle: data.billingCycle,
          price,
          currency: plan.currency,
          startDate: now,
          endDate,
          paymentId: paymentResult.payment.id,
          nextBillingDate: endDate,
        },
      });

      logger.info(`Subscription created: ${subscription.id}`, { userId, planId: plan.id });

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
      const subscription = await prisma.userSubscription.findFirst({
        where: { id: subscriptionId, userId },
      });

      if (!subscription) {
        throw new AppError('Subscription not found', 404);
      }

      if (subscription.status !== 'active') {
        throw new AppError('Subscription is not active', 400);
      }

      const updatedSubscription = await prisma.userSubscription.update({
        where: { id: subscriptionId },
        data: {
          status: 'cancelled',
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

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.payment.count({ where: { userId } }),
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
      const billingCycles = await prisma.billingCycle.findMany({
        where: {
          userSubscription: {
            userId,
          },
        },
        include: {
          userSubscription: {
            include: { plan: true },
          },
          paymentMethod: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const invoices = await prisma.invoice.findMany({
        where: {
          userSubscription: {
            userId,
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        billingCycles,
        invoices,
      };
    } catch (error) {
      logger.error('Get billing history failed:', error);
      throw new AppError('Failed to get billing history', 500);
    }
  }

  // Upgrade plan
  static async upgradePlan(userId: string, planId: string, paymentData: PaymentRequest) {
    try {
      const targetPlan = await prisma.subscriptionPlan.findUnique({
        where: { id: planId },
      });

      if (!targetPlan) {
        throw new AppError('Target plan not found', 404);
      }

      const currentSubscription = await prisma.userSubscription.findFirst({
        where: {
          userId,
          status: 'active',
        },
        include: { plan: true },
      });

      if (!currentSubscription) {
        throw new AppError('No active subscription found', 400);
      }

      // Calculate prorated amount
      const now = new Date();
      const daysRemaining = Math.max(0, Math.ceil((currentSubscription.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      const totalDays = currentSubscription.billingCycle === 'yearly' ? 365 : 30;
      const dailyRate = currentSubscription.price / totalDays;
      const remainingValue = dailyRate * daysRemaining;

      const newPlanPrice = paymentData.amount;
      const upgradeCost = Math.max(0, newPlanPrice - remainingValue);

      // Process upgrade payment
      const paymentResult = await this.processPayment(userId, {
        ...paymentData,
        amount: upgradeCost,
        description: `Plan upgrade: ${currentSubscription.plan.name} → ${targetPlan.name}`,
        metadata: {
          type: 'upgrade',
          fromPlanId: currentSubscription.planId,
          toPlanId: targetPlan.id,
          proratedCredit: remainingValue,
        },
      });

      if (!paymentResult.success) {
        throw new AppError('Upgrade payment failed', 400);
      }

      // Cancel current subscription
      await prisma.userSubscription.update({
        where: { id: currentSubscription.id },
        data: {
          status: 'upgraded',
          endDate: now,
        },
      });

      // Create new subscription
      const endDate = new Date(now);
      if (currentSubscription.billingCycle === 'yearly') {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }

      const newSubscription = await prisma.userSubscription.create({
        data: {
          userId,
          planId: targetPlan.id,
          status: 'active',
          billingCycle: currentSubscription.billingCycle,
          price: newPlanPrice,
          currency: targetPlan.currency,
          startDate: now,
          endDate,
          paymentId: paymentResult.payment.id,
          nextBillingDate: endDate,
        },
      });

      logger.info(`Plan upgraded: ${userId} → ${targetPlan.name}`, { userId, planId });

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
      data: { status: 'completed' },
    });
  }

  private static async handlePaymentFailure(paymentIntent: any) {
    await prisma.payment.updateMany({
      where: { externalId: paymentIntent.id },
      data: { status: 'failed' },
    });
  }

  private static async handleInvoicePaymentSuccess(invoice: any) {
    // Handle subscription invoice payment
    logger.info(`Invoice payment succeeded: ${invoice.id}`);
  }
}

export default PaymentService;
