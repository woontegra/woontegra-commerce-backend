import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { createPlanLimitError, createSubscriptionError } from './AppError';
import { logger } from '../../utils/logger';

const prisma = new PrismaClient();

interface FeatureLimitConfig {
  feature: string;
  limit: number;
  checkFunction: (userId: string, tenantId: string) => Promise<number>;
  errorMessage?: string;
}

// Feature limit configurations
export const featureLimits = {
  products: {
    feature: 'products',
    limit: 20, // FREE plan limit
    checkFunction: async (userId: string, tenantId: string) => {
      const count = await prisma.product.count({
        where: { tenantId },
      });
      return count;
    },
  },
  orders: {
    feature: 'orders',
    limit: 50, // FREE plan limit
    checkFunction: async (userId: string, tenantId: string) => {
      const count = await prisma.order.count({
        where: { tenantId },
      });
      return count;
    },
  },
  customers: {
    feature: 'customers',
    limit: 100, // FREE plan limit
    checkFunction: async (userId: string, tenantId: string) => {
      const count = await prisma.customer.count({
        where: { tenantId },
      });
      return count;
    },
  },
  campaigns: {
    feature: 'campaigns',
    limit: 5, // FREE plan limit
    checkFunction: async (userId: string, tenantId: string) => {
      const count = await prisma.campaign.count({
        where: { tenantId },
      });
      return count;
    },
  },
  apiCalls: {
    feature: 'api_calls',
    limit: 1000, // FREE plan limit per day
    checkFunction: async (userId: string, tenantId: string) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const count = await prisma.log.count({
        where: {
          tenantId,
          createdAt: {
            gte: today,
            lt: tomorrow,
          },
        },
      });
      return count;
    },
  },
};

// Generic feature limit middleware
export const checkFeatureLimit = (config: FeatureLimitConfig) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      
      if (!user) {
        return next();
      }

      // Get user's current subscription
      const activeSubscription = await prisma.subscription.findFirst({
        where: { 
          userId: user.userId,
          status: 'ACTIVE' 
        },
      });
      
      if (!activeSubscription) {
        return next();
      }

      // Check current usage against configured limits
      // Note: plan limits are now managed via PLAN_PRICING config
      const currentUsage = await config.checkFunction(user.userId, user.tenantId);
      
      // TODO: Implement proper plan limit checking based on subscription plan
      // For now, allow access if subscription is active
      const planLimit = 1000; // Default limit, should come from plan config

      return next();
    } catch (err: any) {
      logger.error({
        message: 'Feature limit check failed',
        error: err.message,
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
      });

      return res.status(500).json({
        success: false,
        message: 'Error checking feature limits',
        code: 'FEATURE_LIMIT_CHECK_ERROR',
      });
    }
  };
};

// Specific feature limit middleware factories
export const checkProductLimit = checkFeatureLimit(featureLimits.products);
export const checkOrderLimit = checkFeatureLimit(featureLimits.orders);
export const checkCustomerLimit = checkFeatureLimit(featureLimits.customers);
export const checkCampaignLimit = checkFeatureLimit(featureLimits.campaigns);
export const checkApiCallLimit = checkFeatureLimit(featureLimits.apiCalls);

// Advanced abuse detection
export const detectAbuse = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  
  if (!user) {
    return next();
  }

  // Check for suspicious patterns
  const suspiciousPatterns = [
    // Rapid successive requests
    {
      name: 'rapid_requests',
      check: (req: Request) => {
        const now = Date.now();
        const lastRequest = (req as any).lastRequestTime;
        
        if (lastRequest && (now - lastRequest) < 100) { // Less than 100ms between requests
          return true;
        }
        
        (req as any).lastRequestTime = now;
        return false;
      },
    },
    
    // Unusual user agent
    {
      name: 'suspicious_ua',
      check: (req: Request) => {
        const userAgent = req.get('User-Agent');
        const suspiciousAgents = ['bot', 'crawler', 'scraper', 'automated'];
        
        return userAgent && suspiciousAgents.some(agent => 
          userAgent.toLowerCase().includes(agent)
        );
      },
    },
    
    // Request size anomaly
    {
      name: 'large_payload',
      check: (req: Request) => {
        const contentLength = req.get('content-length');
        return contentLength && parseInt(contentLength) > 10 * 1024 * 1024; // 10MB
      },
    },
  ];

  // Check for suspicious patterns
  for (const pattern of suspiciousPatterns) {
    if (pattern.check(req)) {
      logger.warn({
        message: `Suspicious activity detected: ${pattern.name}`,
        userId: user.userId,
        tenantId: user.tenantId,
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString(),
      });

      return res.status(429).json({
        success: false,
        message: 'Suspicious activity detected',
        code: 'SUSPICIOUS_ACTIVITY',
        pattern: pattern.name,
      });
    }
  }

  return next();
};

// Subscription status check
export const checkSubscriptionStatus = async (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  
  if (!user) {
    return next();
  }

  // Check if subscription is active
  try {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: user.userId,
        status: 'ACTIVE',
        endDate: {
          gte: new Date(),
        },
      },
    });

    if (!subscription) {
      logger.warn({
        message: 'Access denied - no active subscription',
        userId: user.userId,
        tenantId: user.tenantId,
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
      });

      return res.status(403).json({
        success: false,
        message: 'No active subscription found',
        code: 'SUBSCRIPTION_EXPIRED',
      });
    }

    return next();
  } catch (err: any) {
    logger.error({
      message: 'Subscription check failed',
      error: err.message,
      userId: user.userId,
      tenantId: user.tenantId,
      timestamp: new Date().toISOString(),
    });

    return res.status(500).json({
      success: false,
      message: 'Error checking subscription',
      code: 'SUBSCRIPTION_CHECK_ERROR',
    });
  }
};
