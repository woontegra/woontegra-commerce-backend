import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export class CSVExportService {
  /**
   * Convert array to CSV string
   */
  private static arrayToCSV(data: any[], headers: string[]): string {
    const csvRows = [];

    // Add headers
    csvRows.push(headers.join(','));

    // Add data rows
    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header];
        
        // Escape quotes and wrap in quotes if contains comma
        if (value === null || value === undefined) {
          return '';
        }
        
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        
        return stringValue;
      });
      
      csvRows.push(values.join(','));
    });

    return csvRows.join('\n');
  }

  /**
   * Export orders to CSV
   */
  static async exportOrders(tenantId: string, filters?: any): Promise<string> {
    try {
      logger.info('[CSVExport] Exporting orders', { tenantId, filters });

      const orders = await prisma.order.findMany({
        where: {
          tenantId,
          ...filters,
        },
        include: {
          user: true,
          items: {
            include: {
              product: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Flatten order data for CSV
      const csvData = orders.map(order => ({
        orderId: order.id,
        orderNumber: order.orderNumber || '',
        customerName: order.user ? `${order.user.firstName} ${order.user.lastName}` : order.customerName || 'Guest',
        customerEmail: order.user?.email || order.customerEmail || '',
        status: order.status,
        paymentStatus: order.paymentStatus || '',
        total: Number(order.total),
        subtotal: Number(order.subtotal || 0),
        tax: Number(order.tax || 0),
        shippingCost: Number(order.shippingCost || 0),
        itemCount: order.items.length,
        products: order.items.map(item => item.product?.name || 'Unknown').join('; '),
        shippingAddress: order.shippingAddress || '',
        billingAddress: order.billingAddress || '',
        notes: order.notes || '',
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
      }));

      const headers = [
        'orderId',
        'orderNumber',
        'customerName',
        'customerEmail',
        'status',
        'paymentStatus',
        'total',
        'subtotal',
        'tax',
        'shippingCost',
        'itemCount',
        'products',
        'shippingAddress',
        'billingAddress',
        'notes',
        'createdAt',
        'updatedAt',
      ];

      return this.arrayToCSV(csvData, headers);
    } catch (error) {
      logger.error('[CSVExport] Error exporting orders', { error });
      throw error;
    }
  }

  /**
   * Export products to CSV
   */
  static async exportProducts(tenantId: string, filters?: any): Promise<string> {
    try {
      logger.info('[CSVExport] Exporting products', { tenantId, filters });

      const products = await prisma.product.findMany({
        where: {
          tenantId,
          ...filters,
        },
        include: {
          category: true,
          stock: true,
          pricing: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      const csvData = products.map(product => ({
        productId: product.id,
        name: product.name,
        slug: product.slug,
        sku: product.sku || '',
        barcode: product.barcode || '',
        category: product.category?.name || '',
        price: Number(product.price),
        salePrice: product.pricing ? Number(product.pricing.salePrice) : '',
        discountPrice: product.pricing ? Number(product.pricing.discountPrice || 0) : '',
        costPrice: product.pricing ? Number(product.pricing.costPrice || 0) : '',
        taxRate: Number(product.taxRate || 0),
        stock: product.stock ? product.stock.quantity : 0,
        unit: product.unit,
        status: product.status,
        isActive: product.isActive ? 'Yes' : 'No',
        description: product.description || '',
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
      }));

      const headers = [
        'productId',
        'name',
        'slug',
        'sku',
        'barcode',
        'category',
        'price',
        'salePrice',
        'discountPrice',
        'costPrice',
        'taxRate',
        'stock',
        'unit',
        'status',
        'isActive',
        'description',
        'createdAt',
        'updatedAt',
      ];

      return this.arrayToCSV(csvData, headers);
    } catch (error) {
      logger.error('[CSVExport] Error exporting products', { error });
      throw error;
    }
  }

  /**
   * Export customers to CSV
   */
  static async exportCustomers(tenantId: string): Promise<string> {
    try {
      logger.info('[CSVExport] Exporting customers', { tenantId });

      const users = await prisma.user.findMany({
        where: {
          tenantId,
          role: 'USER',
        },
        include: {
          _count: {
            select: {
              orders: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      const csvData = users.map(user => ({
        userId: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || '',
        totalOrders: user._count.orders,
        isActive: user.isActive ? 'Yes' : 'No',
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      }));

      const headers = [
        'userId',
        'firstName',
        'lastName',
        'email',
        'phone',
        'totalOrders',
        'isActive',
        'createdAt',
        'updatedAt',
      ];

      return this.arrayToCSV(csvData, headers);
    } catch (error) {
      logger.error('[CSVExport] Error exporting customers', { error });
      throw error;
    }
  }

  /**
   * Export analytics report to CSV
   */
  static async exportAnalyticsReport(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<string> {
    try {
      logger.info('[CSVExport] Exporting analytics report', { tenantId, startDate, endDate });

      const orders = await prisma.order.findMany({
        where: {
          tenantId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
          status: {
            in: ['completed', 'processing', 'shipped'],
          },
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      // Group by date
      const dailyStats = new Map<string, {
        date: string;
        orders: number;
        revenue: number;
        items: number;
      }>();

      orders.forEach(order => {
        const date = order.createdAt.toISOString().split('T')[0];
        const existing = dailyStats.get(date) || {
          date,
          orders: 0,
          revenue: 0,
          items: 0,
        };

        existing.orders += 1;
        existing.revenue += Number(order.total);
        existing.items += order.items.reduce((sum, item) => sum + item.quantity, 0);

        dailyStats.set(date, existing);
      });

      const csvData = Array.from(dailyStats.values()).sort((a, b) => 
        a.date.localeCompare(b.date)
      );

      const headers = ['date', 'orders', 'revenue', 'items'];

      return this.arrayToCSV(csvData, headers);
    } catch (error) {
      logger.error('[CSVExport] Error exporting analytics report', { error });
      throw error;
    }
  }
}

export const csvExportService = CSVExportService;
