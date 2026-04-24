import { Request, Response } from 'express';
import { invoiceService } from '../../services/invoice.service';
import { logger } from '../../config/logger';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
    email: string;
  };
}

export class InvoiceController {
  /**
   * Get invoice by ID
   */
  async getInvoice(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const invoice = await invoiceService.getInvoice(id, tenantId);

      if (!invoice) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }

      res.json({ success: true, data: invoice });
    } catch (error) {
      logger.error('[Invoice] Error getting invoice', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get tenant invoices
   */
  async getInvoices(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

      const result = await invoiceService.getTenantInvoices(tenantId, page, limit);

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('[Invoice] Error getting invoices', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Create invoice from order
   */
  async createInvoiceFromOrder(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { orderId } = req.body;

      if (!orderId) {
        res.status(400).json({ error: 'Order ID is required' });
        return;
      }

      const invoice = await invoiceService.createInvoiceFromOrder(orderId);

      res.json({ success: true, data: invoice });
    } catch (error) {
      logger.error('[Invoice] Error creating invoice from order', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update invoice status
   */
  async updateInvoiceStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { status } = req.body;

      if (!status) {
        res.status(400).json({ error: 'Status is required' });
        return;
      }

      await invoiceService.updateInvoiceStatus(id, status);

      res.json({ success: true, message: 'Invoice status updated' });
    } catch (error) {
      logger.error('[Invoice] Error updating invoice status', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Generate invoice PDF
   */
  async generateInvoicePDF(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const pdfUrl = await invoiceService.generateInvoicePDF(id);

      res.json({ success: true, data: { pdfUrl } });
    } catch (error) {
      logger.error('[Invoice] Error generating PDF', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const invoiceController = new InvoiceController();
