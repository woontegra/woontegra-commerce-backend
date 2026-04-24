import { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger';

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

  logger.error('Error occurred', {
    message,
    statusCode,
    method: req.method,
    url:    req.url,
    ip:     req.ip,
    stack:  err.stack,
  });

  // Guard: if headers already sent (streaming responses) skip sending
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
