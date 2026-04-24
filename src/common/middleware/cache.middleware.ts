import { Request, Response, NextFunction } from 'express';
import { cache } from '../../config/redis';
import { logger } from '../../config/logger';

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  keyPrefix?: string;
}

export const cacheMiddleware = (options: CacheOptions = {}) => {
  const { ttl = 300, keyPrefix = 'cache' } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Generate cache key
    const tenantId = (req as any).tenantId || 'public';
    const cacheKey = `${keyPrefix}:${tenantId}:${req.originalUrl}`;

    try {
      // Check if cached data exists
      const cachedData = await cache.get(cacheKey);

      if (cachedData) {
        logger.debug('Cache hit', { key: cacheKey });
        return res.status(200).json(cachedData);
      }

      logger.debug('Cache miss', { key: cacheKey });

      // Store original json method
      const originalJson = res.json.bind(res);

      // Override json method to cache response
      res.json = function (data: any) {
        // Cache successful responses only
        if (res.statusCode >= 200 && res.statusCode < 300) {
          cache.set(cacheKey, data, ttl).catch((err) => {
            logger.error('Failed to cache response', { error: err });
          });
        }
        return originalJson(data);
      };

      next();
    } catch (error) {
      logger.error('Cache middleware error', { error });
      next();
    }
  };
};

// Helper to invalidate cache
export const invalidateCache = async (pattern: string) => {
  try {
    await cache.delPattern(pattern);
    logger.info('Cache invalidated', { pattern });
  } catch (error) {
    logger.error('Cache invalidation error', { error });
  }
};
