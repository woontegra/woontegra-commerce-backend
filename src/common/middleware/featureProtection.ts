import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/database';
import { getPlanCountLimit, type PlanCountLimitKey } from '../../config/plans';
import { getEffectivePlanForTenant } from '../../services/planQuota.service';
import { logger } from '../../config/logger';

type LimitCheckConfig = {
  limitKey: PlanCountLimitKey;
  featureLabel: string;
  countUsage: (tenantId: string) => Promise<number>;
};

/**
 * PLAN_CONFIG kotası — yeni kayıt oluşturmadan önce (POST).
 * `currentUsage >= limit` ise 403.
 */
export function enforcePlanLimit(config: LimitCheckConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      if (!user?.tenantId) {
        return next();
      }

      const tenantId = String(user.tenantId);
      const plan = await getEffectivePlanForTenant(tenantId);
      const limit = getPlanCountLimit(plan, config.limitKey);

      if (limit === -1) {
        return next();
      }

      const currentUsage = await config.countUsage(tenantId);

      if (currentUsage >= limit) {
        logger.warn({
          message: 'Plan limit reached',
          tenantId,
          plan,
          limitKey: config.limitKey,
          currentUsage,
          limit,
          path: req.path,
        });

        return res.status(403).json({
          success: false,
          code: 'PLAN_LIMIT_REACHED',
          error: 'PLAN_LIMIT_REACHED',
          message: `${config.featureLabel} limitine ulaştınız. Mevcut planınız en fazla ${limit} kayda izin veriyor.`,
          feature: config.limitKey,
          current: currentUsage,
          limit,
          plan,
        });
      }

      return next();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({
        message: 'Feature limit check failed',
        error: message,
        path: req.path,
        method: req.method,
      });

      return res.status(500).json({
        success: false,
        message: 'Plan limiti kontrol edilemedi.',
        code: 'FEATURE_LIMIT_CHECK_ERROR',
      });
    }
  };
}

export const enforceProductLimit = enforcePlanLimit({
  limitKey: 'maxProducts',
  featureLabel: 'Ürün',
  countUsage: tenantId => prisma.product.count({ where: { tenantId } }),
});

export const enforceOrderLimit = enforcePlanLimit({
  limitKey: 'maxOrders',
  featureLabel: 'Sipariş',
  countUsage: tenantId => prisma.order.count({ where: { tenantId } }),
});

export const enforceCustomerLimit = enforcePlanLimit({
  limitKey: 'maxCustomers',
  featureLabel: 'Müşteri',
  countUsage: tenantId => prisma.customer.count({ where: { tenantId } }),
});

// ── Advanced abuse detection ─────────────────────────────────────────────────

export const detectAbuse = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;

  if (!user) {
    return next();
  }

  const suspiciousPatterns = [
    {
      name: 'rapid_requests',
      check: (r: Request) => {
        const now = Date.now();
        const lastRequest = (r as any).lastRequestTime;

        if (lastRequest && now - lastRequest < 100) {
          return true;
        }

        (r as any).lastRequestTime = now;
        return false;
      },
    },
    {
      name: 'suspicious_ua',
      check: (r: Request) => {
        const userAgent = r.get('User-Agent');
        const suspiciousAgents = ['bot', 'crawler', 'scraper', 'automated'];

        return Boolean(
          userAgent && suspiciousAgents.some(agent => userAgent.toLowerCase().includes(agent)),
        );
      },
    },
    {
      name: 'large_payload',
      check: (r: Request) => {
        const contentLength = r.get('content-length');
        return Boolean(contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024);
      },
    },
  ];

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

// ── Subscription status check ───────────────────────────────────────────────

export const checkSubscriptionStatus = async (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;

  if (!user) {
    return next();
  }

  try {
    const subscription = await prisma.subscription.findFirst({
      where: {
        tenantId: user.tenantId,
        status: 'ACTIVE',
        endDate: { gte: new Date() },
      },
    });

    if (!subscription) {
      logger.warn({
        message: 'Access denied - no active subscription',
        userId: user.userId,
        tenantId: user.tenantId,
        path: req.path,
      });

      return res.status(403).json({
        success: false,
        message: 'No active subscription found',
        code: 'SUBSCRIPTION_EXPIRED',
      });
    }

    return next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ message: 'Subscription check failed', error: message });

    return res.status(500).json({
      success: false,
      message: 'Error checking subscription',
      code: 'SUBSCRIPTION_CHECK_ERROR',
    });
  }
};
