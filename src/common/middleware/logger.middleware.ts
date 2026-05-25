import { Request, Response, NextFunction } from 'express';
import { appLogger } from '../logging/loggers';
import type { TraceableRequest } from './requestId';

type AuthUser = { userId?: string; tenantId?: string };

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const treq = req as TraceableRequest;
  const user = (req as Request & { user?: AuthUser }).user;

  appLogger.info({
    action:   'http_request',
    status:   'pending',
    message:  'Incoming request',
    traceId:  treq.traceId ?? null,
    method:   req.method,
    path:     req.path,
    tenantId: user?.tenantId ?? null,
    userId:   user?.userId ?? null,
  });

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const failed = res.statusCode >= 400;
    const log = failed ? appLogger.warn.bind(appLogger) : appLogger.info.bind(appLogger);

    log({
      action:     'http_response',
      status:     failed ? 'failure' : 'success',
      message:    'Request completed',
      traceId:    treq.traceId ?? null,
      method:     req.method,
      path:       req.path,
      statusCode: res.statusCode,
      durationMs: duration,
      tenantId:   user?.tenantId ?? null,
      userId:     user?.userId ?? null,
    });
  });

  next();
};
