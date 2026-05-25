import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { getPricingSettings, savePricingSettings } from './pricing-settings.service';

export class PricingSettingsController {
  get = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const data = await getPricingSettings(tenantId);
      res.json({ data });
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      if (err?.code === 'P2021' || /pricing_settings|does not exist/i.test(msg)) {
        res.json({
          data: { type: 'none', value: 0, vatRate: 20, rounding: 2, vatIncluded: false },
        });
        return;
      }
      res.status(500).json({ error: err?.message ?? 'Ayarlar yüklenemedi.' });
    }
  };

  save = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const { type, mode, value, vatRate, rounding, roundTo, vatIncluded } = req.body ?? {};
      const data = await savePricingSettings(tenantId, {
        type:        type ?? mode,
        value:       value != null ? Number(value) : undefined,
        vatRate:     vatRate != null ? Number(vatRate) : undefined,
        rounding:    rounding != null ? Number(rounding) : roundTo != null ? Number(roundTo) : undefined,
        vatIncluded: vatIncluded != null ? Boolean(vatIncluded) : undefined,
      });
      res.json({ data, message: 'Fiyat stratejisi kaydedildi.' });
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      if (err?.code === 'P2021' || /pricing_settings|does not exist/i.test(msg)) {
        res.status(503).json({
          error: 'pricing_settings tablosu yok. backend klasöründe: npx prisma migrate deploy',
        });
        return;
      }
      res.status(500).json({ error: err?.message ?? 'Kayıt başarısız.' });
    }
  };
}
