import Redis from 'ioredis';
import { logger } from './logger';

// Support both individual Redis config and Redis URL
const redisConfig = process.env.REDIS_URL 
  ? { url: process.env.REDIS_URL }
  : {
      host:     process.env.REDIS_HOST || 'localhost',
      port:     parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
    };

// Common Redis settings
const commonConfig = {
  // Fail commands immediately when Redis is not reachable instead of
  // queuing them — prevents 10-15 s hangs on every API call
  enableOfflineQueue:   false,
  maxRetriesPerRequest: 0,
  connectTimeout:       3000,     // give up connecting after 3 s

  retryStrategy: (times: number) => {
    if (times > 5) return null;   // stop retrying after 5 attempts
    return Math.min(times * 200, 2000);
  },
};

const finalRedisConfig = { ...redisConfig, ...commonConfig };

export const redis = new Redis(finalRedisConfig);

redis.on('connect', () => {
  logger.info('Redis client connected');
});

redis.on('error', (err) => {
  logger.error('Redis client error:', err);
});

redis.on('ready', () => {
  logger.info('Redis client ready');
});

// Cache helper functions
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('Cache get error:', error);
      return null;
    }
  },

  async set(key: string, value: any, ttl: number = 3600): Promise<void> {
    try {
      await redis.setex(key, ttl, JSON.stringify(value));
    } catch (error) {
      logger.error('Cache set error:', error);
    }
  },

  async del(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (error) {
      logger.error('Cache delete error:', error);
    }
  },

  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      logger.error('Cache delete pattern error:', error);
    }
  },

  async exists(key: string): Promise<boolean> {
    try {
      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Cache exists error:', error);
      return false;
    }
  },
};
