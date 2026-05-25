import { Request, Response, NextFunction } from 'express';
import { appLogger } from '../logging/loggers';
import { getTraceId } from '../logging/trace-context';
import { AppError } from './AppError';

interface ErrorResponse {
  success: false;
  message: string;
  code: string;
  traceId?: string;
  stack?: string; // Only in development
}

export const errorHandler = (
  error: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const traceId =
    (req as Request & { traceId?: string }).traceId ||
    (req.headers['x-trace-id'] as string) ||
    (req.headers['x-request-id'] as string) ||
    getTraceId() ||
    generateTraceId();

  const user = (req as Request & { user?: { userId?: string; id?: string; tenantId?: string } }).user;

  appLogger.error({
    action:     'http_error',
    status:     'failure',
    message:    error.message,
    traceId,
    userId:     user?.userId ?? user?.id ?? null,
    tenantId:   user?.tenantId ?? null,
    path:       req.path,
    method:     req.method,
    statusCode: error instanceof AppError ? error.statusCode : 500,
    error,
  });

  // Determine if this is an AppError or a generic error
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const errorCode = error instanceof AppError ? error.code : 'INTERNAL_SERVER_ERROR';
  const message = error instanceof AppError ? error.message : 'Internal server error';

  // Build error response
  const errorResponse: ErrorResponse = {
    success: false,
    message,
    code: errorCode,
    traceId,
  };

  // Include stack trace only in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = error.stack;
  }

  res.status(statusCode).json(errorResponse);
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export const notFoundHandler = (req: Request, res: Response) => {
  const traceId =
    (req as Request & { traceId?: string }).traceId ||
    (req.headers['x-trace-id'] as string) ||
    (req.headers['x-request-id'] as string) ||
    getTraceId() ||
    generateTraceId();
  
  appLogger.warn({
    action:  'route_not_found',
    status:  'failure',
    message: 'Route not found',
    traceId,
    path:    req.path,
    method:  req.method,
  });

  res.status(404).json({
    success: false,
    message: 'Route not found',
    code: 'ROUTE_NOT_FOUND',
    traceId,
  });
};

// Generate unique trace ID for requests
const generateTraceId = (): string => {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};
