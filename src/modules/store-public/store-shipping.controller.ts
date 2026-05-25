import { Request, Response } from 'express';
import { z } from 'zod';
import { storeShippingCalculationService } from '../shipping/store-shipping-calculation.service';
import { resolveStoreTenant } from './store-tenant.util';

const calculateSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullable().optional(),
        quantity:  z.number().int().min(1).max(999),
      }),
    )
    .min(1),
  paymentProvider: z.enum(['PAYTR', 'BANK_TRANSFER', 'CASH_ON_DELIVERY']).optional(),
});

export async function calculateStoreShipping(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
      return;
    }

    const parsed = calculateSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map(i => i.message).join('; ') || 'Geçersiz istek.';
      res.status(400).json({ success: false, error: msg });
      return;
    }

    const result = await storeShippingCalculationService.calculate(
      tenant.id,
      parsed.data.items,
      parsed.data.paymentProvider,
    );

    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Kargo hesaplanamadı.';
    const isClient = /bulunamadı|aktif değil|geçersiz/i.test(msg);
    res.status(isClient ? 400 : 500).json({ success: false, error: msg });
  }
}
