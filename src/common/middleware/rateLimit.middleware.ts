import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '../../utils/logger';
import { createRateLimitError } from './AppError';

// Enhanced rate limiting with express-rate-limit for better DDOS protection
export const rateLimitConfigs = {
  // General API: 100 requests per minute
  general: {
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    message: 'Too many requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  },
  
  // Auth endpoints: 15 requests per 15 minutes (more restrictive)
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15,
    message: 'Too many authentication attempts, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  },
  
  // File upload: 10 requests per minute
  upload: {
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: 'Too many file uploads, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  },
  
  // Search endpoints: 30 requests per minute
  search: {
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    message: 'Too many search requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  },
  
  // Admin endpoints: 20 requests per minute
  admin: {
    windowMs: 60 * 1000, // 1 minute
    max: 20,
    message: 'Too many admin requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  },
  
  // Registration: 5 requests per hour (very restrictive)
  registration: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: 'Too many registration attempts, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  },
};

// Create rate limit middleware with custom error handler
export const createRateLimit = (config: any) => {
  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: config.message,
    standardHeaders: config.standardHeaders,
    legacyHeaders: config.legacyHeaders,
    handler: (req: Request, res: Response) => {
      const traceId = req.headers['x-request-id'] as string;
      
      // Log rate limit violation
      logger.warn({
        message: 'Rate limit exceeded',
        traceId,
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString(),
      });

      // Return standardized error response
      res.status(429).json({
        success: false,
        message: config.message || 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        traceId,
      });
    },
  });
};

// User-based rate limiting (more restrictive for authenticated users)
export const createUserRateLimit = (baseConfig: any) => {
  return createRateLimit({
    ...baseConfig,
    keyGenerator: (req: Request) => {
      const user = (req as any).user;
      return user ? `user_${user.id}` : `ip_${req.ip}`;
    },
    max: (req: Request) => {
      const user = (req as any).user;
      return user ? Math.floor(baseConfig.max / 2) : baseConfig.max; // 2x more restrictive for authenticated users
    },
  });
};

// IP-based rate limiting (for unauthenticated requests)
export const createIPRateLimit = (baseConfig: any) => {
  return createRateLimit({
    ...baseConfig,
    keyGenerator: (req: Request) => `ip_${req.ip}`,
    max: Math.floor(baseConfig.max / 3), // 3x more restrictive for unknown IPs
  });
};
