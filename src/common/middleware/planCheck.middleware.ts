import { Request, Response } from 'express';
import { PlanMiddleware } from './plan.middleware';

export const checkPlanLimits = async (req: Request, res: Response, next: Function) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { action, resource } = req.body;
    
    const result = await PlanMiddleware.checkPlanLimits(user.id, action, resource);
    
    if (!result.canProceed) {
      return res.status(403).json({ 
        error: 'Plan limit exceeded',
        reason: result.reason,
        currentUsage: result.currentUsage
      });
    }

    return next();
  } catch (error) {
    console.error('Plan limits middleware error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const requireProPlan = PlanMiddleware.requirePlan(['pro', 'advanced']);

export const requireAdvancedPlan = PlanMiddleware.requirePlan(['advanced']);

export const requireApiAccess = PlanMiddleware.checkFeatureAccess('api');

export const requireAnalyticsAccess = PlanMiddleware.checkFeatureAccess('analytics');

export const requireIntegrationsAccess = PlanMiddleware.checkFeatureAccess('integrations');
