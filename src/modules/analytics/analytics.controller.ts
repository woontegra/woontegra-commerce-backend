import { Request, Response } from 'express';
import { AnalyticsService } from '../../services/analytics.service';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

export class AnalyticsController {
  /**
   * Get sales analytics
   */
  async getSalesAnalytics(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }

      const analytics = await AnalyticsService.getSalesAnalytics(tenantId, {
        startDate: new Date(startDate as string),
        endDate: new Date(endDate as string),
      });

      res.json({ success: true, data: analytics });
    } catch (error) {
      console.error('Error getting sales analytics:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get product sales report
   */
  async getProductSalesReport(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }

      const report = await AnalyticsService.getProductSalesReport(tenantId, {
        startDate: new Date(startDate as string),
        endDate: new Date(endDate as string),
      });

      res.json({ success: true, data: report });
    } catch (error) {
      console.error('Error getting product sales report:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get revenue by category
   */
  async getRevenueByCategory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }

      const data = await AnalyticsService.getRevenueByCategory(tenantId, {
        startDate: new Date(startDate as string),
        endDate: new Date(endDate as string),
      });

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error getting revenue by category:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get hourly sales
   */
  async getHourlySales(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }

      const data = await AnalyticsService.getHourlySales(tenantId, {
        startDate: new Date(startDate as string),
        endDate: new Date(endDate as string),
      });

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error getting hourly sales:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get customer analytics
   */
  async getCustomerAnalytics(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }

      const data = await AnalyticsService.getCustomerAnalytics(tenantId, {
        startDate: new Date(startDate as string),
        endDate: new Date(endDate as string),
      });

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error getting customer analytics:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const analyticsController = new AnalyticsController();
