import { Request, Response } from 'express';
import { resolveStoreTenant } from './store-tenant.util';
import { startIyzicoPaymentSchema } from './iyzico/store-iyzico.dto';
import { storeIyzicoService } from './iyzico/store-iyzico.service';
import { startPaytrPaymentSchema } from './paytr/store-paytr.dto';
import { storePaytrService } from './paytr/store-paytr.service';

function clientIp(req: Request): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim();
  }
  const ip = req.socket.remoteAddress || '127.0.0.1';
  return ip.replace(/^::ffff:/, '');
}

export async function startPaytrPayment(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
      return;
    }

    const parsed = startPaytrPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map(i => i.message).join('; ');
      res.status(400).json({ success: false, error: msg || 'Geçersiz istek.' });
      return;
    }

    const result = await storePaytrService.startPayment(tenant, parsed.data, clientIp(req));

    res.json({
      success: true,
      provider: result.provider,
      token:    result.token,
      iframeUrl: result.iframeUrl,
      orderNumber: result.orderNumber,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Ödeme başlatılamadı.';
    const isClient = /bulunamadı|zaten|iptal|eksik|yalnızca|geçersiz|yapılandırma/i.test(msg);
    res.status(isClient ? 400 : 500).json({ success: false, error: msg });
  }
}

export async function startIyzicoPayment(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
      return;
    }

    const parsed = startIyzicoPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map(i => i.message).join('; ');
      res.status(400).json({ success: false, error: msg || 'Geçersiz istek.' });
      return;
    }

    const result = await storeIyzicoService.startPayment(tenant, parsed.data, clientIp(req));

    res.json({
      success:             true,
      provider:            result.provider,
      token:               result.token,
      checkoutFormContent: result.checkoutFormContent,
      orderNumber:         result.orderNumber,
      conversationId:      result.conversationId,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Ödeme başlatılamadı.';
    const isClient = /bulunamadı|zaten|iptal|eksik|yalnızca|geçersiz|uygun değil|iyzico|pasif|geçersiz/i.test(msg);
    res.status(isClient ? 400 : 500).json({ success: false, error: msg });
  }
}

/** iyzico checkout callback — tarayıcı 302 redirect */
export async function iyzicoCallback(req: Request, res: Response): Promise<void> {
  try {
    const raw = req.body?.token ?? req.query?.token;
    const token = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    const { redirectUrl } = await storeIyzicoService.handleCallback(String(token ?? ''));
    res.redirect(302, redirectUrl);
  } catch {
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const failBase = (
      process.env.IYZICO_FAIL_URL?.trim() || `${frontendUrl}/store/odeme-basarisiz`
    ).replace(/\/$/, '');
    res.redirect(302, `${failBase}?reason=server_error`);
  }
}

/** PayTR bildirim URL — gövde application/x-www-form-urlencoded */
export async function paytrCallback(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, string | undefined>;
    await storePaytrService.handleCallback(body);
  } catch {
    // PayTR tekrar denemesin diye yine OK
  }
  res.status(200).send('OK');
}
