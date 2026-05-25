import { Request, Response, NextFunction } from 'express';
import { appLogger } from '../logging/loggers';

export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number, code = 'APP_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code       = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err:  Error | AppError,
  req:  Request,
  res:  Response,
  _next: NextFunction
): void => {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const code       = err instanceof AppError ? err.code       : 'INTERNAL_SERVER_ERROR';
  const message    = err.message || 'Internal Server Error';

  const user = (req as Request & { user?: { userId?: string; tenantId?: string } }).user;

  appLogger.error({
    action:     'http_error',
    status:     'failure',
    message,
    statusCode,
    code,
    method:     req.method,
    path:       req.path,
    tenantId:   user?.tenantId ?? null,
    userId:     user?.userId ?? null,
    error:      err,
  });

  if (res.headersSent) return;

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 && process.env.NODE_ENV === 'production'
      ? 'Sunucu hatası oluştu.'
      : message,
    code,
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
};
