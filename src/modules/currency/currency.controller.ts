import { Request, Response } from 'express';
import { CurrencyService } from '../../services/currency.service';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

export class CurrencyController {
  /**
   * Get all exchange rates
   */
  async getRates(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const rates = await CurrencyService.getAllRates(tenantId);

      res.json({ success: true, data: rates });
    } catch (error) {
      console.error('Error fetching rates:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Convert currency
   */
  async convert(req: Request, res: Response): Promise<void> {
    try {
      const { amount, from, to } = req.body;
      const tenantId = (req as AuthRequest).user?.tenantId;

      if (!amount || !from || !to) {
        res.status(400).json({ error: 'amount, from, and to are required' });
        return;
      }

      const result = await CurrencyService.convert(
        Number(amount),
        from,
        to,
        tenantId
      );

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error converting currency:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update exchange rates (manual trigger)
   */
  async updateRates(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      await CurrencyService.updateExchangeRates(tenantId);

      res.json({ success: true, message: 'Exchange rates updated' });
    } catch (error) {
      console.error('Error updating rates:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get supported currencies
   */
  async getSupportedCurrencies(req: Request, res: Response): Promise<void> {
    try {
      const currencies = CurrencyService.SUPPORTED_CURRENCIES;

      res.json({ success: true, data: currencies });
    } catch (error) {
      console.error('Error fetching currencies:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const currencyController = new CurrencyController();
