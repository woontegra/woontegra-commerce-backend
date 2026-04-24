import { Request, Response, NextFunction } from 'express';
import { AppError } from '../common/middleware/error.middleware';
import prisma from '../config/database';

interface PlanLimits {
  products: number | 'unlimited';
  variants: number | 'unlimited';
  storage: number;
  users: number;
  api: boolean;
  analytics: boolean;
  integrations: boolean;
}

interface PlanFeatures {
  basic: boolean;
  advanced: boolean;
  priority: boolean;
  whiteLabel: boolean;
  api: boolean;
  mobile: boolean;
  support: string;
}

interface CheckLimitsResult {
  canProceed: boolean;
  reason?: string;
  currentUsage?: {
    products: number;
    variants: number;
  };
}

export class PlanMiddleware {
  private static getPlanLimits(planSlug: string): PlanLimits {
    const limits = {
      starter: {
        products: 100,
        variants: 2,
        storage: 5,
        users: 1,
        api: false,
        analytics: false,
        integrations: false
      },
      pro: {
        products: 1000,
        variants: 10,
        storage: 25,
        users: 5,
        api: true,
        analytics: true,
        integrations: true
      },
      advanced: {
        products: 'unlimited',
        variants: 'unlimited',
        storage: 100,
        users: 20,
        api: true,
        analytics: true,
        integrations: true
      }
    };

    return limits[planSlug as keyof typeof limits] || limits.starter;
  }

  private static getPlanFeatures(planSlug: string): PlanFeatures {
    const features = {
      starter: {
        basic: true,
        advanced: false,
        priority: false,
        whiteLabel: false,
        api: false,
        mobile: false,
        support: 'email'
      },
      pro: {
        basic: true,
        advanced: true,
        priority: true,
        whiteLabel: false,
        api: true,
        mobile: true,
        support: 'priority'
      },
      advanced: {
        basic: true,
        advanced: true,
        priority: true,
        whiteLabel: true,
        api: true,
        mobile: true,
        support: 'dedicated'
      }
    };

    return features[planSlug as keyof typeof features] || features.starter;
  }

  static checkPlanLimits = async (userId: string, action: string, resource?: string): Promise<CheckLimitsResult> => {
    try {
      // Get user with current plan
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          subscriptions: {
            include: {
              plan: true
            }
          }
        }
      });

      if (!user) {
        return { canProceed: false, reason: 'User not found' };
      }

      const currentPlan = user.subscriptions[0]?.plan;
      if (!currentPlan) {
        return { canProceed: false, reason: 'No active subscription found' };
      }

      const limits = PlanMiddleware.getPlanLimits(currentPlan.slug);
      const features = PlanMiddleware.getPlanFeatures(currentPlan.slug);

      // Get current usage
      const currentUsage = {
        products: await prisma.product.count({
          where: { 
            tenantId: user.tenantId 
          }
        }),
        variants: await prisma.productVariant.count({
          where: { 
            product: { tenantId: user.tenantId }
          }
        })
      };

      // Check limits based on action
      switch (action) {
        case 'create_product':
          if (limits.products !== 'unlimited' && currentUsage.products >= limits.products) {
            return { 
              canProceed: false, 
              reason: `Product limit reached (${limits.products} products)`,
              currentUsage
            };
          }
          break;

        case 'create_variant':
          if (limits.variants !== 'unlimited' && currentUsage.variants >= limits.variants) {
            return { 
              canProceed: false, 
              reason: `Variant limit reached (${limits.variants} variants per product)`,
              currentUsage
            };
          }
          break;

        case 'access_api':
          if (!features.api) {
            return { 
              canProceed: false, 
              reason: 'API access not available in current plan',
              currentUsage
            };
          }
          break;

        case 'access_analytics':
          if (!features.analytics) {
            return { 
              canProceed: false, 
              reason: 'Advanced analytics not available in current plan',
              currentUsage
            };
          }
          break;

        case 'access_integrations':
          if (!features.integrations) {
            return { 
              canProceed: false, 
              reason: 'Third-party integrations not available in current plan',
              currentUsage
            };
          }
          break;
      }

      return { canProceed: true, currentUsage };

    } catch (error) {
      console.error('Plan limit check failed:', error);
      return { canProceed: false, reason: 'Internal server error' };
    }
  };

  static requirePlan = (requiredPlans: string[]) => {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = (req as any).user;
        if (!user) {
          return res.status(401).json({ error: 'Authentication required' });
        }

        const userWithSubscription = await prisma.user.findUnique({
          where: { id: user.id },
          include: {
            subscriptions: {
              include: {
                plan: true
              }
            }
          }
        });

        const currentPlan = userWithSubscription?.subscriptions[0]?.plan?.slug;
        
        if (!currentPlan || !requiredPlans.includes(currentPlan)) {
          return res.status(403).json({ 
            error: 'Plan upgrade required',
            requiredPlans,
            currentPlan,
            message: `This feature requires ${requiredPlans.join(' or ')} plan`
          });
        }

        // Add plan info to request for use in controllers
        (req as any).userPlan = {
          slug: currentPlan,
          limits: PlanMiddleware.getPlanLimits(currentPlan),
          features: PlanMiddleware.getPlanFeatures(currentPlan)
        };

        next();
      } catch (error) {
        console.error('Plan middleware error:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    };
  };

  static checkFeatureAccess = (feature: string) => {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = (req as any).user;
        if (!user) {
          return res.status(401).json({ error: 'Authentication required' });
        }

        const userWithSubscription = await prisma.user.findUnique({
          where: { id: user.id },
          include: {
            subscriptions: {
              include: {
                plan: true
              }
            }
          }
        });

        const currentPlan = userWithSubscription?.subscriptions[0]?.plan?.slug;
        if (!currentPlan) {
          return res.status(403).json({ error: 'No active subscription found' });
        }

        const features = PlanMiddleware.getPlanFeatures(currentPlan);
        
        // Check if user has access to requested feature
        const hasAccess = features[feature as keyof PlanFeatures];
        
        if (!hasAccess) {
          return res.status(403).json({ 
            error: 'Feature not available in current plan',
            feature,
            currentPlan,
            message: `This feature requires a higher plan`
          });
        }

        next();
      } catch (error) {
        console.error('Feature access check error:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    };
  };

  static getUsageStats = async (userId: string) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          subscriptions: {
            include: {
              plan: true
            }
          }
        }
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const currentPlan = user.subscriptions[0]?.plan;
      if (!currentPlan) {
        throw new AppError('No active subscription found', 404);
      }

      const limits = PlanMiddleware.getPlanLimits(currentPlan.slug);
      
      // Get current usage
      const usage = {
        products: await prisma.product.count({
          where: { tenantId: user.tenantId }
        }),
        variants: await prisma.productVariant.count({
          where: { product: { tenantId: user.tenantId } }
        }),
        orders: await prisma.order.count({
          where: { tenantId: user.tenantId }
        }),
        customers: await prisma.customer.count({
          where: { tenantId: user.tenantId }
        })
      };

      return {
        plan: currentPlan,
        limits,
        usage,
        percentages: {
          products: limits.products === 'unlimited' ? 0 : (usage.products / limits.products) * 100,
          variants: limits.variants === 'unlimited' ? 0 : (usage.variants / limits.variants) * 100
        }
      };
    } catch (error) {
      console.error('Usage stats error:', error);
      throw error;
    }
  };
}
