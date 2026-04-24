import { Router, Request, Response } from 'express';
import { requireSuperAdmin } from '../../common/middleware/superAdmin.middleware';
import { authenticate } from '../../common/middleware/authEnhanced';
import { FeatureService } from './feature.service';
import { FeatureKey } from './feature.constants';
import { logger } from '../../config/logger';

const router = Router();
const featureService = new FeatureService();

interface AuthReq extends Request {
  user?: { userId: string; tenantId: string; role: string; email: string };
}

// ── GET /api/features — current tenant's feature flags + plan (for frontend) ──
router.get('/', authenticate, async (req: AuthReq, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ success: false });

    const [flags, plan] = await Promise.all([
      featureService.getTenantFlags(tenantId),
      featureService.getTenantPlan(tenantId),
    ]);

    const planFeatureKeys = featureService.getPlanFeatureKeys(plan);

    return res.json({
      success: true,
      data: {
        flags,
        plan,
        planFeatureKeys,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/admin/features — list all feature definitions ───────────────────
router.get('/admin/all', requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const features = await featureService.listFeatures();
    return res.json({ success: true, data: features });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/features/matrix/:tenantId — feature matrix for a tenant (admin) ──
router.get('/matrix/:tenantId', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const matrix = await featureService.getFeatureMatrix(req.params.tenantId);
    return res.json({ success: true, data: matrix });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/features/toggle — toggle single feature (admin) ────────────────
router.post('/toggle', requireSuperAdmin, async (req: AuthReq, res: Response) => {
  try {
    const { tenantId, featureKey, enabled } = req.body;

    if (!tenantId || !featureKey || typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'tenantId, featureKey ve enabled (boolean) zorunludur.',
      });
    }

    await featureService.setFeature(tenantId, featureKey as FeatureKey, enabled);

    logger.info({
      message: '[Admin] Feature toggled',
      adminId: req.user?.userId,
      tenantId,
      featureKey,
      enabled,
    });

    return res.json({
      success: true,
      message: `"${featureKey}" ${enabled ? 'aktifleştirildi' : 'devre dışı bırakıldı'}.`,
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// ── POST /api/features/bulk — set multiple features at once (admin) ───────────
router.post('/bulk', requireSuperAdmin, async (req: AuthReq, res: Response) => {
  try {
    const { tenantId, overrides } = req.body;

    if (!tenantId || !overrides || typeof overrides !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'tenantId ve overrides (object) zorunludur.',
      });
    }

    await featureService.bulkSetFeatures(tenantId, overrides);
    return res.json({ success: true, message: 'Feature\'lar güncellendi.' });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// ── POST /api/features/reset — reset tenant to defaults (admin) ───────────────
router.post('/reset', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.body;
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenantId zorunludur.' });

    await featureService.resetToDefaults(tenantId);
    return res.json({ success: true, message: 'Feature\'lar varsayılanlara sıfırlandı.' });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
