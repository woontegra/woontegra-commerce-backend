import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { tenantShippingSettingsService } from './tenant-shipping-settings.service';

export async function getShippingSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const settings = await tenantShippingSettingsService.getForAdmin(tenantId);
    res.json({ success: true, settings });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Kargo ayarları alınamadı.';
    res.status(500).json({ success: false, error: msg });
  }
}

export async function upsertShippingSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const settings = await tenantShippingSettingsService.upsert(
      tenantId,
      (req.body ?? {}) as Record<string, unknown>,
    );
    res.json({ success: true, settings });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Kargo ayarları kaydedilemedi.';
    res.status(500).json({ success: false, error: msg });
  }
}
