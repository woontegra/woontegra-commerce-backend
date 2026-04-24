import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import * as svc from './webhook.service';
import { WEBHOOK_EVENTS } from './webhook.service';

const tid = (req: AuthRequest) => req.user!.tenantId!;

// ─── GET /api/webhooks ────────────────────────────────────────────────────────

export const listWebhooks = async (req: AuthRequest, res: Response): Promise<void> => {
  const hooks = await svc.listWebhooks(tid(req));
  res.json({ success: true, data: hooks });
};

// ─── GET /api/webhooks/events ─────────────────────────────────────────────────

export const listEvents = async (_req: any, res: Response): Promise<void> => {
  res.json({ success: true, data: WEBHOOK_EVENTS });
};

// ─── POST /api/webhooks ───────────────────────────────────────────────────────

export const createWebhook = async (req: AuthRequest, res: Response): Promise<void> => {
  const { url, events, description } = req.body;

  if (!url || !events?.length) {
    res.status(400).json({ success: false, message: 'url ve events zorunlu.' });
    return;
  }

  try { new URL(url); } catch {
    res.status(400).json({ success: false, message: 'Geçersiz URL.' });
    return;
  }

  const invalid = (events as string[]).filter(e => !WEBHOOK_EVENTS.includes(e as any));
  if (invalid.length) {
    res.status(400).json({ success: false, message: `Geçersiz event tipi: ${invalid.join(', ')}` });
    return;
  }

  const hook = await svc.createWebhook(tid(req), { url, events, description });
  res.status(201).json({ success: true, data: hook });
};

// ─── GET /api/webhooks/:id ────────────────────────────────────────────────────

export const getWebhook = async (req: AuthRequest, res: Response): Promise<void> => {
  const hook = await svc.getWebhook(req.params.id, tid(req));
  if (!hook) { res.status(404).json({ success: false, message: 'Bulunamadı.' }); return; }
  res.json({ success: true, data: hook });
};

// ─── PUT /api/webhooks/:id ────────────────────────────────────────────────────

export const updateWebhook = async (req: AuthRequest, res: Response): Promise<void> => {
  const { url, events, description, isActive } = req.body;
  await svc.updateWebhook(req.params.id, tid(req), { url, events, description, isActive });
  res.json({ success: true, message: 'Güncellendi.' });
};

// ─── DELETE /api/webhooks/:id ─────────────────────────────────────────────────

export const deleteWebhook = async (req: AuthRequest, res: Response): Promise<void> => {
  await svc.deleteWebhook(req.params.id, tid(req));
  res.json({ success: true, message: 'Silindi.' });
};

// ─── POST /api/webhooks/:id/rotate-secret ────────────────────────────────────

export const rotateSecret = async (req: AuthRequest, res: Response): Promise<void> => {
  const hook = await svc.rotateSecret(req.params.id, tid(req));
  if (!hook) { res.status(404).json({ success: false, message: 'Bulunamadı.' }); return; }
  res.json({ success: true, data: { secret: hook.secret } });
};

// ─── POST /api/webhooks/:id/test ──────────────────────────────────────────────

export const testWebhook = async (req: AuthRequest, res: Response): Promise<void> => {
  const result = await svc.testWebhook(req.params.id, tid(req));
  if (!result) { res.status(404).json({ success: false, message: 'Bulunamadı.' }); return; }
  res.json({ success: true, data: result });
};

// ─── GET /api/webhooks/:id/logs ───────────────────────────────────────────────

export const getWebhookLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  const page  = parseInt(req.query.page as string || '1', 10);
  const limit = parseInt(req.query.limit as string || '20', 10);
  const data  = await svc.getWebhookLogs(req.params.id, tid(req), page, limit);
  if (!data) { res.status(404).json({ success: false, message: 'Bulunamadı.' }); return; }
  res.json({ success: true, data });
};
