import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface SalesAnalytics {
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  topProducts: Array<{
    productId: string;
    productName: string;
    quantity: number;
    revenue: number;
  }>;
  dailyRevenue: Array<{
    date: string;
    revenue: number;
    orders: number;
  }>;
}

export interface ProductSalesReport {
  productId: string;
  productName: string;
  totalQuantity: number;
  totalRevenue: number;
  orderCount: number;
  averagePrice: number;
}

export class AnalyticsService {
  /**
   * Get sales analytics for date range
   */
  static async getSalesAnalytics(
    tenantId: string,
    dateRange: DateRange
  ): Promise<SalesAnalytics> {
    try {
      const { startDate, endDate } = dateRange;

      // Get orders in date range
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

      // Calculate total revenue
      const totalRevenue = orders.reduce((sum, order) => {
        return sum + Number(order.total);
      }, 0);

      // Calculate average order value
      const averageOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;

      // Calculate top products
      const productSales = new Map<string, {
        name: string;
        quantity: number;
        revenue: number;
      }>();

      orders.forEach(order => {
        order.items.forEach(item => {
          const existing = productSales.get(item.productId) || {
            name: item.product?.name || 'Unknown',
            quantity: 0,
            revenue: 0,
          };

          existing.quantity += item.quantity;
          existing.revenue += Number(item.price) * item.quantity;

          productSales.set(item.productId, existing);
        });
      });

      const topProducts = Array.from(productSales.entries())
        .map(([productId, data]) => ({
          productId,
          productName: data.name,
          quantity: data.quantity,
          revenue: data.revenue,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

      // Calculate daily revenue
      const dailyRevenueMap = new Map<string, { revenue: number; orders: number }>();

      orders.forEach(order => {
        const date = order.createdAt.toISOString().split('T')[0];
        const existing = dailyRevenueMap.get(date) || { revenue: 0, orders: 0 };

        existing.revenue += Number(order.total);
        existing.orders += 1;

        dailyRevenueMap.set(date, existing);
      });

      const dailyRevenue = Array.from(dailyRevenueMap.entries())
        .map(([date, data]) => ({
          date,
          revenue: Number(data.revenue.toFixed(2)),
          orders: data.orders,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalOrders: orders.length,
        averageOrderValue: Number(averageOrderValue.toFixed(2)),
        topProducts,
        dailyRevenue,
      };
    } catch (error) {
      logger.error('[AnalyticsService] Error getting sales analytics', { error });
      throw error;
    }
  }

  /**
   * Get product sales report
   */
  static async getProductSalesReport(
    tenantId: string,
    dateRange: DateRange
  ): Promise<ProductSalesReport[]> {
    try {
      const { startDate, endDate } = dateRange;

      const orderItems = await prisma.orderItem.findMany({
        where: {
          order: {
            tenantId,
            createdAt: {
              gte: startDate,
              lte: endDate,
            },
            status: {
              in: ['completed', 'processing', 'shipped'],
            },
          },
        },
        include: {
          product: true,
        },
      });

      // Group by product
      const productMap = new Map<string, {
        name: string;
        quantity: number;
        revenue: number;
        orderCount: number;
      }>();

      orderItems.forEach(item => {
        const existing = productMap.get(item.productId) || {
          name: item.product?.name || 'Unknown',
          quantity: 0,
          revenue: 0,
          orderCount: 0,
        };

        existing.quantity += item.quantity;
        existing.revenue += Number(item.price) * item.quantity;
        existing.orderCount += 1;

        productMap.set(item.productId, existing);
      });

      return Array.from(productMap.entries())
        .map(([productId, data]) => ({
          productId,
          productName: data.name,
          totalQuantity: data.quantity,
          totalRevenue: Number(data.revenue.toFixed(2)),
          orderCount: data.orderCount,
          averagePrice: Number((data.revenue / data.quantity).toFixed(2)),
        }))
        .sort((a, b) => b.totalRevenue - a.totalRevenue);
    } catch (error) {
      logger.error('[AnalyticsService] Error getting product sales report', { error });
      throw error;
    }
  }

  /**
   * Get revenue by category
   */
  static async getRevenueByCategory(
    tenantId: string,
    dateRange: DateRange
  ) {
    try {
      const { startDate, endDate } = dateRange;

      const orderItems = await prisma.orderItem.findMany({
        where: {
          order: {
            tenantId,
            createdAt: {
              gte: startDate,
              lte: endDate,
            },
            status: {
              in: ['completed', 'processing', 'shipped'],
            },
          },
        },
        include: {
          product: {
            include: {
              category: true,
            },
          },
        },
      });

      const categoryMap = new Map<string, {
        name: string;
        revenue: number;
        quantity: number;
      }>();

      orderItems.forEach(item => {
        const categoryId = item.product?.categoryId || 'uncategorized';
        const categoryName = item.product?.category?.name || 'Uncategorized';

        const existing = categoryMap.get(categoryId) || {
          name: categoryName,
          revenue: 0,
          quantity: 0,
        };

        existing.revenue += Number(item.price) * item.quantity;
        existing.quantity += item.quantity;

        categoryMap.set(categoryId, existing);
      });

      return Array.from(categoryMap.entries())
        .map(([categoryId, data]) => ({
          categoryId,
          categoryName: data.name,
          revenue: Number(data.revenue.toFixed(2)),
          quantity: data.quantity,
        }))
        .sort((a, b) => b.revenue - a.revenue);
    } catch (error) {
      logger.error('[AnalyticsService] Error getting revenue by category', { error });
      throw error;
    }
  }

  /**
   * Get hourly sales distribution
   */
  static async getHourlySales(
    tenantId: string,
    dateRange: DateRange
  ) {
    try {
      const { startDate, endDate } = dateRange;

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
      });

      const hourlyMap = new Map<number, { orders: number; revenue: number }>();

      // Initialize all hours
      for (let i = 0; i < 24; i++) {
        hourlyMap.set(i, { orders: 0, revenue: 0 });
      }

      orders.forEach(order => {
        const hour = order.createdAt.getHours();
        const existing = hourlyMap.get(hour)!;

        existing.orders += 1;
        existing.revenue += Number(order.total);

        hourlyMap.set(hour, existing);
      });

      return Array.from(hourlyMap.entries())
        .map(([hour, data]) => ({
          hour,
          orders: data.orders,
          revenue: Number(data.revenue.toFixed(2)),
        }))
        .sort((a, b) => a.hour - b.hour);
    } catch (error) {
      logger.error('[AnalyticsService] Error getting hourly sales', { error });
      throw error;
    }
  }

  /**
   * Get customer analytics
   */
  static async getCustomerAnalytics(
    tenantId: string,
    dateRange: DateRange
  ) {
    try {
      const { startDate, endDate } = dateRange;

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
      });

      const customerMap = new Map<string, {
        orders: number;
        revenue: number;
      }>();

      orders.forEach(order => {
        const customerId = order.userId || 'guest';
        const existing = customerMap.get(customerId) || {
          orders: 0,
          revenue: 0,
        };

        existing.orders += 1;
        existing.revenue += Number(order.total);

        customerMap.set(customerId, existing);
      });

      const totalCustomers = customerMap.size;
      const repeatCustomers = Array.from(customerMap.values()).filter(
        c => c.orders > 1
      ).length;

      return {
        totalCustomers,
        newCustomers: totalCustomers - repeatCustomers,
        repeatCustomers,
        repeatRate: totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0,
      };
    } catch (error) {
      logger.error('[AnalyticsService] Error getting customer analytics', { error });
      throw error;
    }
  }
}

export const analyticsService = AnalyticsService;
