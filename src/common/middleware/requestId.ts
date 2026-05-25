import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { enrichTraceContext, runWithTrace } from '../logging/trace-context';

export type TraceableRequest = Request & { traceId?: string };

/**
 * Her HTTP isteği için benzersiz trace ID üretir ve AsyncLocalStorage ile yayar.
 * Gelen `x-trace-id` / `x-request-id` header'ları korunur.
 */
export const requestIdMiddleware = (req: TraceableRequest, res: Response, next: NextFunction): void => {
  const incoming =
    (req.headers['x-trace-id'] as string | undefined) ||
    (req.headers['x-request-id'] as string | undefined);

  const traceId = incoming?.trim() || randomUUID();

  req.traceId = traceId;
  req.headers['x-trace-id']   = traceId;
  req.headers['x-request-id'] = traceId;
  res.setHeader('x-trace-id', traceId);
  res.setHeader('x-request-id', traceId);

  runWithTrace({ traceId }, () => next());
};

/** Auth sonrası tenant/user bilgisini trace bağlamına ekler */
export function traceContextFromAuth(req: TraceableRequest): void {
  const user = (req as TraceableRequest & { user?: { userId?: string; id?: string; tenantId?: string } }).user;
  if (!user) return;
  enrichTraceContext({
    userId:   user.userId ?? user.id ?? null,
    tenantId: user.tenantId ?? null,
  });
}

/** @deprecated requestIdMiddleware kullanın */
export const requestLoggerMiddleware = requestIdMiddleware;
