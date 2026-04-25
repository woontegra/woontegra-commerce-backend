import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Add unique trace ID to each request
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const traceId = req.headers['x-request-id'] as string || uuidv4();
  
  // Add trace ID to request headers
  req.headers['x-request-id'] = traceId;
  
  // Add trace ID to response headers
  res.setHeader('x-request-id', traceId);
  
  next();
};

// Request logging middleware
export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  
  // Log request
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - Request started`);
  
  // Override res.end to log response time
  const originalEnd = res.end.bind(res);
  res.end = function(chunk?: any, encoding?: any): any {
    const responseTime = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${responseTime}ms)`);
    
    // Call original end
    return originalEnd(chunk, encoding);
  };
  
  return next();
};
