import { Request, Response } from 'express';
import { TaxService } from '../../services/tax.service';

export class TaxController {
  /**
   * Calculate tax for items
   * POST /api/tax/calculate
   */
  async calculate(req: Request, res: Response): Promise<void> {
    try {
      const { items } = req.body;

      if (!items || !Array.isArray(items)) {
        res.status(400).json({ error: 'Items array is required' });
        return;
      }

      const result = TaxService.calculateTax(items);

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error calculating tax:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get tax breakdown by rate
   * POST /api/tax/breakdown
   */
  async breakdown(req: Request, res: Response): Promise<void> {
    try {
      const { items } = req.body;

      if (!items || !Array.isArray(items)) {
        res.status(400).json({ error: 'Items array is required' });
        return;
      }

      const breakdown = TaxService.getTaxBreakdown(items);

      res.json({ success: true, data: breakdown });
    } catch (error) {
      console.error('Error calculating tax breakdown:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get available tax rates
   * GET /api/tax/rates
   */
  async getRates(req: Request, res: Response): Promise<void> {
    try {
      const rates = [
        { value: 20, label: 'Standart KDV (%20)', description: 'Genel ürünler' },
        { value: 10, label: 'İndirimli KDV 1 (%10)', description: 'Gıda, kitap vb.' },
        { value: 1, label: 'İndirimli KDV 2 (%1)', description: 'Temel gıda' },
        { value: 0, label: 'Muaf (%0)', description: 'KDV muaf ürünler' },
      ];

      res.json({ success: true, data: rates });
    } catch (error) {
      console.error('Error fetching tax rates:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const taxController = new TaxController();
