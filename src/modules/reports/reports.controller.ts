import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Parser } from 'json2csv';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

// ── Helper: last N calendar dates (YYYY-MM-DD) ────────────────────────────────
function buildDateRange(days: number): string[] {
  const result: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

export class ReportsController {
  /**
   * GET /reports/overview
   * Trendyol send overview — real data from IntegrationLog.
   * Multi-tenant: all queries scoped to req.user.tenantId.
   * Performance: one $queryRaw for date buckets + two aggregate counts in parallel.
   */
  async getOverview(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);

      // ── Aggregate counts (all-time) ─────────────────────────────────────────
      const [successCount, errorCount, skippedCount, totalProducts] = await Promise.all([
        prisma.integrationLog.count({ where: { tenantId, status: 'success' } }),
        prisma.integrationLog.count({ where: { tenantId, status: 'error'   } }),
        prisma.integrationLog.count({ where: { tenantId, status: 'skipped' } }),
        prisma.product.count({         where: { tenantId } }),
      ]);

      const successRate =
        successCount + errorCount > 0
          ? Math.round((successCount / (successCount + errorCount)) * 100)
          : 0;

      // ── Last N days — one raw query, group by UTC date ───────────────────────
      // Prisma $queryRaw returns COUNT as BigInt; convert to Number.
      const rawRows = await prisma.$queryRaw<
        Array<{ date: string; success: bigint; error: bigint }>
      >`
        SELECT
          TO_CHAR(DATE("createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
          COUNT(CASE WHEN status = 'success' THEN 1 END)              AS success,
          COUNT(CASE WHEN status = 'error'   THEN 1 END)              AS error
        FROM "IntegrationLog"
        WHERE "tenantId" = ${tenantId}
          AND "createdAt" >= NOW() - (${days} || ' days')::INTERVAL
        GROUP BY DATE("createdAt" AT TIME ZONE 'UTC')
        ORDER BY DATE("createdAt" AT TIME ZONE 'UTC') ASC
      `;

      // Fill in missing dates with zeros so the chart is continuous
      const rawMap = new Map(rawRows.map(r => [r.date, r]));
      const allDates = buildDateRange(days);
      const last7Days = allDates.map(date => {
        const row = rawMap.get(date);
        return {
          date,
          success: row ? Number(row.success) : 0,
          error:   row ? Number(row.error)   : 0,
        };
      });

      // ── Bonus: last 10 successful sends ─────────────────────────────────────
      const recentSent = await prisma.integrationLog.findMany({
        where:   { tenantId, status: 'success' },
        orderBy: { createdAt: 'desc' },
        take:    10,
        select:  { productId: true, productName: true, createdAt: true, batchId: true },
      });

      // ── Bonus: top 5 products with most errors ───────────────────────────────
      const topErrors = await prisma.integrationLog.groupBy({
        by:      ['productId', 'productName'],
        where:   { tenantId, status: 'error' },
        _count:  { status: true },
        orderBy: { _count: { status: 'desc' } },
        take:    5,
      });

      return res.json({
        success: true,
        data: {
          totalProducts,
          sentProducts:    successCount,
          failedProducts:  errorCount,
          skippedProducts: skippedCount,
          successRate,
          last7Days,
          recentSent,
          topErrors: topErrors.map(t => ({
            productId:   t.productId,
            productName: t.productName,
            errorCount:  t._count.status,
          })),
        },
      });
    } catch (error) {
      logger.error('[Reports/overview]', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  /**
   * GET /reports/sales
   * Sales report with date range filtering
   */
  async salesReport(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      const { startDate, endDate, groupBy = 'day' } = req.query;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const where: any = { tenantId };

      if (startDate && endDate) {
        where.createdAt = {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string),
        };
      }

      // Get orders with items
      const orders = await prisma.order.findMany({
        where,
        include: {
          items: {
            include: {
              product: {
                select: {
                  name: true,
                  category: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      // Calculate metrics
      const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
      const totalOrders = orders.length;
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      // Group by date
      const salesByDate: Record<string, { revenue: number; orders: number }> = {};
      
      orders.forEach(order => {
        const date = order.createdAt;
        let key: string;

        if (groupBy === 'month') {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        } else if (groupBy === 'week') {
          const weekNum = Math.ceil(date.getDate() / 7);
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-W${weekNum}`;
        } else {
          key = date.toISOString().split('T')[0];
        }

        if (!salesByDate[key]) {
          salesByDate[key] = { revenue: 0, orders: 0 };
        }

        salesByDate[key].revenue += order.total;
        salesByDate[key].orders += 1;
      });

      // Status breakdown
      const statusBreakdown = orders.reduce((acc, order) => {
        acc[order.status] = (acc[order.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return res.json({
        success: true,
        data: {
          summary: {
            totalRevenue,
            totalOrders,
            averageOrderValue,
          },
          salesByDate: Object.entries(salesByDate).map(([date, data]) => ({
            date,
            ...data,
          })),
          statusBreakdown,
        },
      });
    } catch (error) {
      console.error('Sales report error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  /**
   * GET /reports/products
   * Product performance report
   */
  async productPerformance(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      const { startDate, endDate, limit = '10' } = req.query;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const where: any = { tenantId };

      if (startDate && endDate) {
        where.createdAt = {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string),
        };
      }

      // Get order items with products
      const orderItems = await prisma.orderItem.findMany({
        where: {
          order: where,
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              price: true,
              stock: true,
              category: {
                select: { name: true },
              },
            },
          },
        },
      });

      // Aggregate by product
      const productStats: Record<string, any> = {};

      orderItems.forEach(item => {
        const productId = item.product.id;

        if (!productStats[productId]) {
          productStats[productId] = {
            productId,
            productName: item.product.name,
            category: item.product.category?.name || 'Uncategorized',
            currentPrice: item.product.price,
            currentStock: item.product.stock,
            totalSold: 0,
            totalRevenue: 0,
            orderCount: 0,
          };
        }

        productStats[productId].totalSold += item.quantity;
        productStats[productId].totalRevenue += item.price * item.quantity;
        productStats[productId].orderCount += 1;
      });

      // Convert to array and sort by revenue
      const topProducts = Object.values(productStats)
        .sort((a: any, b: any) => b.totalRevenue - a.totalRevenue)
        .slice(0, parseInt(limit as string));

      // Category breakdown
      const categoryStats: Record<string, any> = {};
      
      Object.values(productStats).forEach((product: any) => {
        const category = product.category;
        if (!categoryStats[category]) {
          categoryStats[category] = {
            category,
            totalRevenue: 0,
            totalSold: 0,
            productCount: 0,
          };
        }
        categoryStats[category].totalRevenue += product.totalRevenue;
        categoryStats[category].totalSold += product.totalSold;
        categoryStats[category].productCount += 1;
      });

      return res.json({
        success: true,
        data: {
          topProducts,
          categoryBreakdown: Object.values(categoryStats),
          totalProducts: Object.keys(productStats).length,
        },
      });
    } catch (error) {
      console.error('Product performance error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  /**
   * GET /reports/customers
   * Customer analytics report
   */
  async customerAnalytics(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      const { startDate, endDate } = req.query;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const where: any = { tenantId };

      if (startDate && endDate) {
        where.createdAt = {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string),
        };
      }

      // Get customers with their orders
      const customers = await prisma.customer.findMany({
        where: { tenantId },
        include: {
          orders: {
            where: startDate && endDate ? {
              createdAt: {
                gte: new Date(startDate as string),
                lte: new Date(endDate as string),
              },
            } : undefined,
          },
        },
      });

      // Calculate customer metrics
      const customerStats = customers.map(customer => {
        const orders = customer.orders;
        const totalSpent = orders.reduce((sum, order) => sum + order.total, 0);
        const orderCount = orders.length;
        const averageOrderValue = orderCount > 0 ? totalSpent / orderCount : 0;

        return {
          customerId: customer.id,
          customerName: `${customer.firstName} ${customer.lastName}`,
          email: customer.email,
          totalSpent,
          orderCount,
          averageOrderValue,
          lastOrderDate: orders.length > 0 
            ? orders[orders.length - 1].createdAt 
            : null,
        };
      });

      // Sort by total spent
      const topCustomers = customerStats
        .sort((a, b) => b.totalSpent - a.totalSpent)
        .slice(0, 10);

      // Customer segments
      const segments = {
        vip: customerStats.filter(c => c.totalSpent > 1000).length,
        regular: customerStats.filter(c => c.totalSpent > 100 && c.totalSpent <= 1000).length,
        new: customerStats.filter(c => c.totalSpent <= 100).length,
      };

      // Total metrics
      const totalCustomers = customers.length;
      const activeCustomers = customerStats.filter(c => c.orderCount > 0).length;
      const totalRevenue = customerStats.reduce((sum, c) => sum + c.totalSpent, 0);
      const averageCustomerValue = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;

      return res.json({
        success: true,
        data: {
          summary: {
            totalCustomers,
            activeCustomers,
            averageCustomerValue,
          },
          topCustomers,
          segments,
        },
      });
    } catch (error) {
      console.error('Customer analytics error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  /**
   * GET /reports/export
   * Export report as CSV
   */
  async exportCSV(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      const { type, startDate, endDate } = req.query;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      let data: any[] = [];
      let fields: string[] = [];
      let filename = 'report.csv';

      if (type === 'sales') {
        const where: any = { tenantId };
        if (startDate && endDate) {
          where.createdAt = {
            gte: new Date(startDate as string),
            lte: new Date(endDate as string),
          };
        }

        const orders = await prisma.order.findMany({
          where,
          include: {
            customer: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        });

        data = orders.map(order => ({
          'Order ID': order.id,
          'Date': order.createdAt.toISOString().split('T')[0],
          'Customer': `${order.customer.firstName} ${order.customer.lastName}`,
          'Email': order.customer.email,
          'Total': order.total,
          'Status': order.status,
        }));

        fields = ['Order ID', 'Date', 'Customer', 'Email', 'Total', 'Status'];
        filename = 'sales-report.csv';

      } else if (type === 'products') {
        const products = await prisma.product.findMany({
          where: { tenantId },
          include: {
            category: {
              select: { name: true },
            },
          },
        });

        data = products.map(product => ({
          'Product ID': product.id,
          'Name': product.name,
          'SKU': product.sku,
          'Category': product.category?.name || 'N/A',
          'Price': product.price,
          'Stock': product.stock,
          'Status': product.isActive ? 'Active' : 'Inactive',
        }));

        fields = ['Product ID', 'Name', 'SKU', 'Category', 'Price', 'Stock', 'Status'];
        filename = 'products-report.csv';

      } else if (type === 'customers') {
        const customers = await prisma.customer.findMany({
          where: { tenantId },
          include: {
            orders: true,
          },
        });

        data = customers.map(customer => ({
          'Customer ID': customer.id,
          'Name': `${customer.firstName} ${customer.lastName}`,
          'Email': customer.email,
          'Phone': customer.phone || 'N/A',
          'City': customer.city || 'N/A',
          'Total Orders': customer.orders.length,
          'Total Spent': customer.orders.reduce((sum, o) => sum + o.total, 0),
        }));

        fields = ['Customer ID', 'Name', 'Email', 'Phone', 'City', 'Total Orders', 'Total Spent'];
        filename = 'customers-report.csv';
      }

      if (data.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No data',
          message: 'No data available for export',
        });
      }

      const parser = new Parser({ fields });
      const csv = parser.parse(data);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);

    } catch (error) {
      console.error('Export CSV error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
}
