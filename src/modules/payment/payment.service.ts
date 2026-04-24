import { Request, Response } from 'express';
import { AppError } from '../../common/middleware/error.middleware';
import prisma from '../../config/database';
import { PlanMiddleware } from '../../common/middleware/plan.middleware';
import crypto from 'crypto';

interface PaymentRequest {
  planId: string;
  paymentMethodId: string;
  billingCycle: 'monthly' | 'yearly';
  savePaymentMethod?: boolean;
}

interface IyzicoPaymentData {
  token: string;
  cardHolderName: string;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
}

interface BankTransferData {
  accountHolder: string;
  accountNumber: string;
  bankName: string;
  iban: string;
  receipt: string;
}

export class PaymentService {
  private static generateInvoiceNumber(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `INV-${year}-${month}-${random}`;
  }

  static async processPayment(userId: string, paymentData: PaymentRequest) {
    try {
      // Get user and plan details
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          subscriptions: {
            include: { plan: true }
          }
        }
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const currentSubscription = user.subscriptions[0];
      if (!currentSubscription) {
        throw new AppError('No active subscription found', 404);
      }

      const plan = currentSubscription.plan;
      
      // Calculate amount based on billing cycle
      let amount = plan.price;
      if (paymentData.billingCycle === 'yearly') {
        amount = plan.price * 12 * 0.9; // 20% discount for yearly
      }

      // Create billing cycle
      const billingCycle = await prisma.billingCycle.create({
        data: {
          userSubscriptionId: currentSubscription.id,
          startDate: new Date(),
          endDate: paymentData.billingCycle === 'yearly' 
            ? new Date(new Date().setFullYear(new Date().getFullYear() + 1))
            : new Date(new Date().setMonth(new Date().getMonth() + 1)),
          amount,
          currency: plan.currency,
          status: 'pending'
        }
      });

      // Process payment based on payment method
      const paymentMethod = await prisma.paymentMethod.findUnique({
        where: { id: paymentData.paymentMethodId }
      });

      if (!paymentMethod) {
        throw new AppError('Payment method not found', 404);
      }

      let paymentResult;
      switch (paymentMethod.type) {
        case 'iyzico':
          paymentResult = await this.processIyzicoPayment(userId, amount, paymentData as IyzicoPaymentData);
          break;
        case 'bank_transfer':
          paymentResult = await this.processBankTransfer(userId, amount, paymentData as BankTransferData);
          break;
        case 'credit_card':
          paymentResult = await this.processCreditCardPayment(userId, amount, paymentData);
          break;
        default:
          throw new AppError('Unsupported payment method', 400);
      }

      // Update billing cycle status
      await prisma.billingCycle.update({
        where: { id: billingCycle.id },
        data: {
          status: paymentResult.success ? 'paid' : 'failed',
          paymentMethodId: paymentData.paymentMethodId,
          paymentProvider: paymentResult.provider,
          transactionId: paymentResult.transactionId,
          failureReason: paymentResult.error
        }
      });

      // Update subscription if payment successful
      if (paymentResult.success) {
        await prisma.userSubscription.update({
          where: { id: currentSubscription.id },
          data: {
            status: 'active',
            currentPeriodEnd: billingCycle.endDate
          }
        });

        // Create invoice
        await prisma.invoice.create({
          data: {
            invoiceNumber: this.generateInvoiceNumber(),
            userSubscriptionId: currentSubscription.id,
            amount,
            currency: plan.currency,
            status: 'paid',
            dueDate: new Date(),
            paidDate: new Date(),
            items: JSON.stringify([
              {
                description: `${plan.name} Planı - ${paymentData.billingCycle === 'yearly' ? 'Yıllık' : 'Aylık'}`,
                quantity: 1,
                unitPrice: amount,
                total: amount
              }
            ])
          }
        });
      }

      return {
        success: paymentResult.success,
        billingCycleId: billingCycle.id,
        invoiceId: paymentResult.success ? 'generated' : null,
        error: paymentResult.error
      };

    } catch (error) {
      console.error('Payment processing failed:', error);
      throw new AppError('Payment processing failed', 500);
    }
  }

  private static async processIyzicoPayment(userId: string, amount: number, paymentData: IyzicoPaymentData) {
    try {
      // Mock Iyzico API call
      console.log('Processing Iyzico payment:', { amount, ...paymentData });
      
      // Simulate successful payment
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return {
        success: true,
        provider: 'iyzico',
        transactionId: `IYZ-${Date.now()}`
      };
    } catch (error) {
      return {
        success: false,
        error: 'Iyzico payment failed',
        provider: 'iyzico'
      };
    }
  }

  private static async processBankTransfer(userId: string, amount: number, paymentData: BankTransferData) {
    try {
      // Mock bank transfer processing
      console.log('Processing bank transfer:', { amount, ...paymentData });
      
      // Simulate successful payment
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      return {
        success: true,
        provider: 'bank',
        transactionId: `BANK-${Date.now()}`
      };
    } catch (error) {
      return {
        success: false,
        error: 'Bank transfer failed',
        provider: 'bank'
      };
    }
  }

  private static async processCreditCardPayment(userId: string, amount: number, paymentData: any) {
    try {
      // Mock credit card processing
      console.log('Processing credit card payment:', { amount, ...paymentData });
      
      // Simulate successful payment
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return {
        success: true,
        provider: 'stripe',
        transactionId: `CC-${Date.now()}`
      };
    } catch (error) {
      return {
        success: false,
        error: 'Credit card payment failed',
        provider: 'stripe'
      };
    }
  }

  static async savePaymentMethod(userId: string, paymentData: any) {
    try {
      const paymentMethodData = {
        type: paymentData.type,
        provider: paymentData.provider,
        token: paymentData.token,
        lastFour: paymentData.lastFour,
        expiryDate: paymentData.expiryDate,
        isDefault: paymentData.isDefault || false
      };

      // If setting as default, unset other defaults
      if (paymentMethodData.isDefault) {
        await prisma.paymentMethod.updateMany({
          where: { 
            userId,
            isDefault: true 
          },
          data: { isDefault: false }
        });
      }

      const paymentMethod = await prisma.paymentMethod.create({
        data: {
          userId,
          ...paymentMethodData
        }
      });

      return {
        success: true,
        paymentMethod
      };
    } catch (error) {
      console.error('Save payment method failed:', error);
      throw new AppError('Failed to save payment method', 500);
    }
  }

  static async getUserPaymentMethods(userId: string) {
    try {
      const paymentMethods = await prisma.paymentMethod.findMany({
        where: { 
          userId,
          isActive: true 
        },
        orderBy: { isDefault: 'desc' }
      });

      return {
        success: true,
        paymentMethods
      };
    } catch (error) {
      console.error('Get payment methods failed:', error);
      throw new AppError('Failed to get payment methods', 500);
    }
  }

  static async deletePaymentMethod(userId: string, paymentMethodId: string) {
    try {
      const paymentMethod = await prisma.paymentMethod.findUnique({
        where: { id: paymentMethodId, userId }
      });

      if (!paymentMethod) {
        throw new AppError('Payment method not found', 404);
      }

      await prisma.paymentMethod.delete({
        where: { id: paymentMethodId }
      });

      return {
        success: true,
        message: 'Payment method deleted successfully'
      };
    } catch (error) {
      console.error('Delete payment method failed:', error);
      throw new AppError('Failed to delete payment method', 500);
    }
  }

  static async getBillingHistory(userId: string) {
    try {
      const billingCycles = await prisma.billingCycle.findMany({
        where: { 
          userSubscription: {
            userId
          }
        },
        include: {
          userSubscription: {
            include: { plan: true }
          }
        },
        paymentMethod: true
        },
        orderBy: { createdAt: 'desc' }
      });

      const invoices = await prisma.invoice.findMany({
        where: { 
          userSubscription: {
            userId
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return {
        success: true,
        billingCycles,
        invoices
      };
    } catch (error) {
      console.error('Get billing history failed:', error);
      throw new AppError('Failed to get billing history', 500);
    }
  }

  static async upgradePlan(userId: string, planId: string, paymentData: PaymentRequest) {
    try {
      // Get target plan
      const targetPlan = await prisma.subscriptionPlan.findUnique({
        where: { id: planId }
      });

      if (!targetPlan) {
        throw new AppError('Target plan not found', 404);
      }

      // Check if user has active subscription
      const currentSubscription = await prisma.userSubscription.findFirst({
        where: { 
          userId,
          status: 'active'
        },
        include: { plan: true }
      });

      if (currentSubscription) {
        // Cancel current subscription
        await prisma.userSubscription.update({
          where: { id: currentSubscription.id },
          data: {
            status: 'cancelled',
            cancelledAt: new Date()
          }
        });
      }

      // Process payment for new plan
      const paymentResult = await this.processPayment(userId, {
        ...paymentData,
        planId
      });

      if (!paymentResult.success) {
        throw new AppError('Payment failed', 400);
      }

      // Create new subscription
      const newSubscription = await prisma.userSubscription.create({
        data: {
          userId,
          planId,
          status: 'active',
          currentPeriodStart: new Date()
        }
      });

      return {
        success: true,
        subscription: newSubscription,
        billingCycleId: paymentResult.billingCycleId,
        invoiceId: paymentResult.invoiceId
      };
    } catch (error) {
      console.error('Plan upgrade failed:', error);
      throw new AppError('Plan upgrade failed', 500);
    }
  }
}
