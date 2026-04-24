import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { inAppService } from './inapp.service';

export async function getNotifications(req: AuthRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId!;
  const page  = parseInt(req.query.page  as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  const result = await inAppService.getAll(tenantId, page, limit);
  res.json({ success: true, ...result });
}

export async function getUnreadCount(req: AuthRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId!;
  const count = await inAppService.getUnreadCount(tenantId);
  res.json({ success: true, count });
}

export async function markRead(req: AuthRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId!;
  const { id }   = req.params;
  await inAppService.markRead(id, tenantId);
  res.json({ success: true });
}

export async function markAllRead(req: AuthRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId!;
  await inAppService.markAllRead(tenantId);
  res.json({ success: true });
}
