import { Request, Response, NextFunction } from 'express';
import { FeatureService } from './feature.service';
import { FeatureKey, getMinPlanForFeature } from './feature.constants';
import { logger } from '../../config/logger';

const featureService = new FeatureService();

interface AuthRequest extends Request {
  user?: { userId: string; tenantId: string; role: string; email: string };
}

/**
 * Route-level middleware that blocks access when a feature is disabled.
 *
 * Usage:
 *   router.post('/campaigns', authenticate, checkFeature('campaigns'), handler)
 */
export function checkFeature(featureKey: FeatureKey) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // SUPER_ADMIN always bypasses feature flags
    if (req.user?.role === 'SUPER_ADMIN') return next();

    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: 'Kimlik doğrulama gerekli.', code: 'UNAUTHORIZED' });
    }

    try {
      const enabled = await featureService.isEnabled(tenantId, featureKey);

      if (!enabled) {
        logger.info({
          message: '[FeatureFlag] Access denied — feature disabled',
          tenantId,
          featureKey,
          path: req.path,
        });
        return res.status(403).json({
          success:    false,
          message:    `Bu özellik hesabınızda aktif değil: ${featureKey}`,
          code:       'FEATURE_DISABLED',
          feature:    featureKey,
        });
      }

      next();
    } catch (err) {
      logger.error({ message: '[FeatureFlag] Middleware error', featureKey, err });
      next(); // fail open — don't block users on internal errors
    }
  };
}

/**
 * Plan-aware feature gate.
 *
 * Checks BOTH:
 *  1. The tenant's plan (does the plan include this feature?)
 *  2. Admin overrides via TenantFeature table
 *
 * SUPER_ADMIN always bypasses. Returns 403 with PLAN_UPGRADE_REQUIRED
 * including `requiredPlan` so the frontend can show the upgrade CTA.
 *
 * Usage:
 *   router.post('/campaigns/apply', authenticate, checkPlanFeature('campaign_advanced'), handler)
 */
export function checkPlanFeature(featureKey: FeatureKey) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.role === 'SUPER_ADMIN') return next();

    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: 'Kimlik doğrulama gerekli.', code: 'UNAUTHORIZED' });
    }

    try {
      const enabled = await featureService.isEnabled(tenantId, featureKey);

      if (enabled) return next();

      // Feature disabled — figure out which plan unlocks it
      const [currentPlan, requiredPlan] = await Promise.all([
        featureService.getTenantPlan(tenantId),
        Promise.resolve(getMinPlanForFeature(featureKey)),
      ]);

      logger.info({
        message: '[PlanGate] Access denied — plan upgrade required',
        tenantId,
        featureKey,
        currentPlan,
        requiredPlan,
        path: req.path,
      });

      return res.status(403).json({
        success:      false,
        code:         'PLAN_UPGRADE_REQUIRED',
        message:      `Bu özellik için ${requiredPlan} planına yükseltmeniz gerekiyor.`,
        feature:      featureKey,
        currentPlan,
        requiredPlan,
      });
    } catch (err) {
      logger.error({ message: '[PlanGate] Middleware error', featureKey, err });
      next(); // fail open
    }
  };
}

/**
 * Attaches the full feature flag map to req.features so handlers
 * can check multiple flags without extra DB calls.
 */
export const attachFeatureFlags = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId || req.user?.role === 'SUPER_ADMIN') {
    (req as any).features = {};
    return next();
  }

  try {
    (req as any).features = await featureService.getTenantFlags(tenantId);
  } catch {
    (req as any).features = {};
  }

  next();
};
