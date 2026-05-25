import { Response } from 'express';
import { PaymentProviderType } from '@prisma/client';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { PAYMENT_PROVIDER_TYPES } from './payment-provider.types';
import { tenantPaymentSettingsService } from './tenant-payment-settings.service';

function parseProvider(param: string): PaymentProviderType | null {
  const u = param.toUpperCase();
  return PAYMENT_PROVIDER_TYPES.includes(u as PaymentProviderType)
    ? (u as PaymentProviderType)
    : null;
}

export async function listPaymentSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const settings = await tenantPaymentSettingsService.listForAdmin(tenantId);
    res.json({ success: true, settings });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Ödeme ayarları alınamadı.';
    res.status(500).json({ success: false, error: msg });
  }
}

export async function upsertPaymentSetting(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const provider = parseProvider(req.params.provider ?? '');
    if (!provider) {
      res.status(400).json({ success: false, error: 'Geçersiz ödeme sağlayıcısı.' });
      return;
    }

    const setting = await tenantPaymentSettingsService.upsert(
      tenantId,
      provider,
      (req.body ?? {}) as Record<string, unknown>,
    );
    res.json({ success: true, setting });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Ödeme ayarı kaydedilemedi.';
    const isCrypto = /MARKETPLACE_ENCRYPTION_KEY/i.test(msg);
    res.status(isCrypto ? 503 : 500).json({ success: false, error: msg });
  }
}
