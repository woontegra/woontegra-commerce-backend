import { PrismaClient, InvoiceType, InvoiceStatus, OrderStatus } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export interface InvoiceLineItem {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  taxRate?: number;
}

export interface InvoiceData {
  tenantId: string;
  type: InvoiceType;
  currency?: string;
  subtotal: number;
  tax: number;
  total: number;
  description?: string;
  lineItems: InvoiceLineItem[];
  dueDate?: Date;
  periodStart?: Date;
  periodEnd?: Date;
  metadata?: any;
}

export class InvoiceService {
  /**
   * Generate invoice number
   */
  static generateInvoiceNumber(tenantId: string): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    // Format: INV-{tenantSlug}-{YYYYMM}-{sequence}
    return `INV-${tenantId.substring(0, 8)}-${year}${month}-${Date.now().toString().slice(-4)}`;
  }

  /**
   * Create invoice from order
   */
  static async createInvoiceFromOrder(orderId: string): Promise<any> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          customer: true,
          tenant: true,
        },
      });

      if (!order) {
        throw new Error('Order not found');
      }

      // Check if invoice already exists
      const existingInvoice = await prisma.invoice.findFirst({
        where: {
          metadata: {
            path: ['orderId'],
            equals: orderId,
          },
        },
      });

      if (existingInvoice) {
        logger.warn('[Invoice] Invoice already exists for order', {
          orderId,
          invoiceId: existingInvoice.id,
        });
        return existingInvoice;
      }

      // Calculate totals
      let subtotal = 0;
      let totalTax = 0;
      const lineItems: InvoiceLineItem[] = [];

      for (const item of order.items) {
        const itemTotal = Number(item.price) * item.quantity;
        const itemTax = itemTotal * 0.18; // 18% KDV
        
        subtotal += itemTotal;
        totalTax += itemTax;

        lineItems.push({
          name: item.product.name,
          description: item.product.description || '',
          quantity: item.quantity,
          unitPrice: Number(item.price),
          total: itemTotal,
          taxRate: 18,
        });
      }

      const total = subtotal + totalTax;

      // Create invoice
      const invoice = await prisma.invoice.create({
        data: {
          tenantId: order.tenantId,
          type: 'ORDER',
          status: 'DRAFT',
          number: this.generateInvoiceNumber(order.tenantId),
          currency: 'TRY',
          subtotal,
          tax: totalTax,
          total,
          description: `Invoice for Order #${order.orderNumber}`,
          lineItems,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          metadata: {
            orderId,
            orderNumber: order.orderNumber,
            customerId: order.customerId,
            customerEmail: order.customer.email,
          },
        },
      });

      logger.info('[Invoice] Invoice created from order', {
        invoiceId: invoice.id,
        orderId,
        invoiceNumber: invoice.number,
        total: Number(invoice.total),
      });

      return invoice;
    } catch (error) {
      logger.error('[Invoice] Error creating invoice from order', { error, orderId });
      throw error;
    }
  }

  /**
   * Create subscription invoice
   */
  static async createSubscriptionInvoice(data: {
    tenantId: string;
    subscriptionId: string;
    paymentId: string;
    plan: string;
    billingCycle: string;
    amount: number;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<any> {
    try {
      const { tenantId, subscriptionId, paymentId, plan, billingCycle, amount, periodStart, periodEnd } = data;

      const lineItems: InvoiceLineItem[] = [
        {
          name: `${plan} Plan - ${billingCycle}`,
          description: `Subscription for ${billingCycle.toLowerCase()} period`,
          quantity: 1,
          unitPrice: amount,
          total: amount,
          taxRate: 18,
        },
      ];

      const tax = amount * 0.18;
      const total = amount + tax;

      const invoice = await prisma.invoice.create({
        data: {
          tenantId,
          subscriptionId,
          paymentId,
          type: 'SUBSCRIPTION',
          status: 'COMPLETED',
          number: this.generateInvoiceNumber(tenantId),
          currency: 'TRY',
          subtotal: amount,
          tax,
          total,
          description: `Subscription invoice for ${plan} plan`,
          lineItems,
          periodStart,
          periodEnd,
          paidAt: new Date(),
          metadata: {
            plan,
            billingCycle,
            autoGenerated: true,
          },
        },
      });

      logger.info('[Invoice] Subscription invoice created', {
        invoiceId: invoice.id,
        subscriptionId,
        amount,
        total,
      });

      return invoice;
    } catch (error) {
      logger.error('[Invoice] Error creating subscription invoice', { error });
      throw error;
    }
  }

  /**
   * Update invoice status
   */
  static async updateInvoiceStatus(
    invoiceId: string,
    status: InvoiceStatus,
    metadata?: any
  ): Promise<void> {
    try {
      const updateData: any = { status };

      if (status === 'COMPLETED') {
        updateData.paidAt = new Date();
      } else if (status === 'VOIDED') {
        updateData.voidedAt = new Date();
      }

      if (metadata) {
        updateData.metadata = metadata;
      }

      await prisma.invoice.update({
        where: { id: invoiceId },
        data: updateData,
      });

      logger.info('[Invoice] Invoice status updated', {
        invoiceId,
        status,
        paidAt: status === 'COMPLETED' ? new Date() : undefined,
      });
    } catch (error) {
      logger.error('[Invoice] Error updating invoice status', { error });
      throw error;
    }
  }

  /**
   * Get invoice by ID
   */
  static async getInvoice(invoiceId: string, tenantId: string): Promise<any> {
    try {
      const invoice = await prisma.invoice.findFirst({
        where: {
          id: invoiceId,
          tenantId,
        },
        include: {
          subscription: {
            select: {
              plan: true,
              billingCycle: true,
              startDate: true,
              endDate: true,
            },
          },
          payment: {
            select: {
              amount: true,
              status: true,
              transactionId: true,
              createdAt: true,
            },
          },
        },
      });

      return invoice;
    } catch (error) {
      logger.error('[Invoice] Error getting invoice', { error });
      throw error;
    }
  }

  /**
   * Get tenant invoices
   */
  static async getTenantInvoices(
    tenantId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    invoices: any[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    try {
      const skip = (page - 1) * limit;

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where: { tenantId },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            subscription: {
              select: {
                plan: true,
                billingCycle: true,
              },
            },
            payment: {
              select: {
                amount: true,
                status: true,
              },
            },
          },
        }),
        prisma.invoice.count({ where: { tenantId } }),
      ]);

      return {
        invoices,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('[Invoice] Error getting tenant invoices', { error });
      throw error;
    }
  }

  /**
   * Process order completion - auto-generate invoice
   */
  static async processOrderCompletion(orderId: string): Promise<void> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true, tenantId: true },
      });

      if (!order) {
        logger.warn('[Invoice] Order not found for auto-invoice', { orderId });
        return;
      }

      if (order.status !== OrderStatus.COMPLETED) {
        logger.info('[Invoice] Order not completed, skipping invoice', {
          orderId,
          status: order.status,
        });
        return;
      }

      // Check tenant settings for auto-invoice
      const tenant = await prisma.tenant.findUnique({
        where: { id: order.tenantId },
        select: { settings: true },
      });

      const settings = tenant?.settings as any;
      const autoInvoiceEnabled = settings?.autoInvoice ?? true; // Default enabled

      if (!autoInvoiceEnabled) {
        logger.info('[Invoice] Auto-invoice disabled for tenant', {
          tenantId: order.tenantId,
        });
        return;
      }

      // Create invoice
      const invoice = await this.createInvoiceFromOrder(orderId);

      // Mark invoice as completed (order already paid)
      await this.updateInvoiceStatus(invoice.id, 'COMPLETED', {
        autoGenerated: true,
        orderId,
      });

      logger.info('[Invoice] Auto-invoice generated for order', {
        orderId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
      });
    } catch (error) {
      logger.error('[Invoice] Error processing order completion', { error, orderId });
      throw error;
    }
  }

  /**
   * Generate invoice PDF (placeholder)
   */
  static async generateInvoicePDF(invoiceId: string): Promise<string> {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          tenant: {
            select: {
              name: true,
              settings: true,
            },
          },
        },
      });

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      // TODO: Implement PDF generation
      // Use a library like puppeteer or pdfkit
      const pdfUrl = `/invoices/${invoice.id}.pdf`;

      logger.info('[Invoice] PDF generated', {
        invoiceId,
        pdfUrl,
      });

      return pdfUrl;
    } catch (error) {
      logger.error('[Invoice] Error generating PDF', { error });
      throw error;
    }
  }
}

export const invoiceService = InvoiceService;
