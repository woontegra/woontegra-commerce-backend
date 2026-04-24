import { Request, Response, NextFunction } from 'express';
import { ApiRequest } from './apiAuth';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetAt: number;
  };
}

const store: RateLimitStore = {};

/**
 * Rate Limiting Middleware
 * Limits requests per minute based on API token
 */
export function rateLimit(req: ApiRequest, res: Response, next: NextFunction) {
  const tokenId = req.apiToken?.id;
  const limit = req.apiToken?.rateLimit || 100;

  if (!tokenId) {
    return next();
  }

  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const key = `api_${tokenId}`;

  // Initialize or reset if window expired
  if (!store[key] || now > store[key].resetAt) {
    store[key] = {
      count: 0,
      resetAt: now + windowMs,
    };
  }

  store[key].count++;

  const remaining = Math.max(0, limit - store[key].count);
  const resetIn = Math.ceil((store[key].resetAt - now) / 1000);

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', limit.toString());
  res.setHeader('X-RateLimit-Remaining', remaining.toString());
  res.setHeader('X-RateLimit-Reset', resetIn.toString());

  if (store[key].count > limit) {
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: `Too many requests. Limit: ${limit} requests per minute`,
      retryAfter: resetIn,
    });
  }

  next();
}

/**
 * Cleanup old entries periodically
 */
setInterval(() => {
  const now = Date.now();
  Object.keys(store).forEach(key => {
    if (now > store[key].resetAt + 60000) {
      delete store[key];
    }
  });
}, 60000); // Cleanup every minute
