import { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/middleware/authEnhanced';
import {
  executeRetryAction,
  getBusinessMetrics,
  queryErrorAlerts,
  queryPlatformLogs,
} from './observability.service';

function tenantUser(req: AuthenticatedRequest) {
  const tenantId = req.user?.tenantId;
  const userId   = req.user?.userId;
  if (!tenantId || !userId) return null;
  return { tenantId, userId };
}

export async function getLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
  const ctx = tenantUser(req);
  if (!ctx) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const data = await queryPlatformLogs({
    tenantId: ctx.tenantId,
    page:     parseInt(String(req.query.page ?? '1'), 10) || 1,
    limit:    parseInt(String(req.query.limit ?? '30'), 10) || 30,
    module:   req.query.module as string | undefined,
    level:    req.query.level as string | undefined,
    traceId:  req.query.traceId as string | undefined,
    search:   req.query.search as string | undefined,
    event:    req.query.event as string | undefined,
  });

  res.json({ success: true, data });
}

export async function getAlerts(req: AuthenticatedRequest, res: Response): Promise<void> {
  const ctx = tenantUser(req);
  if (!ctx) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const data = await queryErrorAlerts(
    ctx.tenantId,
    parseInt(String(req.query.page ?? '1'), 10) || 1,
    parseInt(String(req.query.limit ?? '20'), 10) || 20,
  );

  res.json({ success: true, data });
}

export async function getMetrics(req: AuthenticatedRequest, res: Response): Promise<void> {
  const ctx = tenantUser(req);
  if (!ctx) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const days = parseInt(String(req.query.days ?? '7'), 10) || 7;
  const data = await getBusinessMetrics(ctx.tenantId, days);
  res.json({ success: true, data });
}

export async function postRetry(req: AuthenticatedRequest, res: Response): Promise<void> {
  const ctx = tenantUser(req);
  if (!ctx) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { type, payload } = req.body as { type?: string; payload?: Record<string, string> };
  if (!type) {
    res.status(400).json({ success: false, message: 'type gerekli' });
    return;
  }

  try {
    const result = await executeRetryAction(ctx.tenantId, ctx.userId, type, payload ?? {});
    res.json({ success: result.ok, message: result.message, data: result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Retry başarısız';
    res.status(500).json({ success: false, message });
  }
}
