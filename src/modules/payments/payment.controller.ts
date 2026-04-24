import { Request, Response } from 'express';
import { PaymentService } from '../../services/payment.service';
import { AppError } from '../../common/middleware/error.middleware';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class PaymentController {
  private paymentService: PaymentService;

  constructor() {
    this.paymentService = new PaymentService();
  }

  processPayment = async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        orderId,
        amount,
        currency = 'USD',
        paymentMethodId, // Stripe
        cardDetails, // iyzico
      } = req.body;

      if (!orderId || !amount) {
        throw new AppError('Order ID and amount are required', 400);
      }

      // Verify order exists and is pending
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          customer: true,
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      if (order.status !== 'PENDING') {
        throw new AppError('Order is not in pending status', 400);
      }

      // Verify amount matches order total
      const orderTotal = Number(order.totalAmount);
      if (Math.abs(orderTotal - amount) > 0.01) {
        throw new AppError('Payment amount does not match order total', 400);
      }

      // Process payment
      const paymentResult = await this.paymentService.processPayment({
        amount,
        currency,
        description: `Order #${order.orderNumber}`,
        customerEmail: order.customer.email,
        customerName: `${order.customer.firstName} ${order.customer.lastName}`,
        paymentMethodId,
        cardDetails,
      });

      if (!paymentResult.success) {
        throw new AppError(paymentResult.error || 'Payment failed', 400);
      }

      // Update order status to PAID
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'PROCESSING', // or 'PAID' if you have that status
        },
      });

      res.status(200).json({
        status: 'success',
        data: {
          order: updatedOrder,
          payment: {
            transactionId: paymentResult.transactionId,
            success: true,
          },
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Payment processing failed' });
      }
    }
  };

  refundPayment = async (req: Request, res: Response): Promise<void> => {
    try {
      const { transactionId, amount } = req.body;

      if (!transactionId) {
        throw new AppError('Transaction ID is required', 400);
      }

      const refundResult = await this.paymentService.refundPayment(
        transactionId,
        amount
      );

      if (!refundResult.success) {
        throw new AppError(refundResult.error || 'Refund failed', 400);
      }

      res.status(200).json({
        status: 'success',
        data: {
          refund: {
            transactionId: refundResult.transactionId,
            success: true,
          },
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Refund processing failed' });
      }
    }
  };
}
