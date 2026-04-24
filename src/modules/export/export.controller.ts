import { Request, Response } from 'express';
import { CSVExportService } from '../../services/csv-export.service';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

export class ExportController {
  /**
   * Export orders to CSV
   */
  async exportOrders(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { status, startDate, endDate } = req.query;

      const filters: any = {};
      if (status) filters.status = status;
      if (startDate && endDate) {
        filters.createdAt = {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string),
        };
      }

      const csv = await CSVExportService.exportOrders(tenantId, filters);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
      res.send(csv);
    } catch (error) {
      console.error('Error exporting orders:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Export products to CSV
   */
  async exportProducts(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { status, categoryId } = req.query;

      const filters: any = {};
      if (status) filters.status = status;
      if (categoryId) filters.categoryId = categoryId;

      const csv = await CSVExportService.exportProducts(tenantId, filters);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
      res.send(csv);
    } catch (error) {
      console.error('Error exporting products:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Export customers to CSV
   */
  async exportCustomers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const csv = await CSVExportService.exportCustomers(tenantId);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=customers.csv');
      res.send(csv);
    } catch (error) {
      console.error('Error exporting customers:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Export analytics report to CSV
   */
  async exportAnalytics(req: AuthRequest, res: Response): Promise<void> {
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

      const csv = await CSVExportService.exportAnalyticsReport(
        tenantId,
        new Date(startDate as string),
        new Date(endDate as string)
      );

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=analytics-report.csv');
      res.send(csv);
    } catch (error) {
      console.error('Error exporting analytics:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const exportController = new ExportController();
