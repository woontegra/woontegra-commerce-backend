import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';
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
  const traceId = req.headers['x-request-id'] as string || generateTraceId();
  
  // Log the error
  logger.error({
    message: error.message,
    stack: error.stack,
    traceId,
    userId: (req as any).user?.id,
    tenantId: (req as any).user?.tenantId,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
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
  const traceId = req.headers['x-request-id'] as string || generateTraceId();
  
  logger.warn({
    message: 'Route not found',
    traceId,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
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
