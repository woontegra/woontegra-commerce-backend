import { Router } from 'express';
import { CampaignController } from './campaign.controller';
import { checkPlanFeature } from '../features/feature.middleware';

// Auth + tenant guard applied globally in main.ts for /api/campaigns
const router = Router();
const ctrl   = new CampaignController();

// Basic campaign features — Starter+
router.get   ('/',             ctrl.getAll);
router.get   ('/stats',        ctrl.getStats);
router.get   ('/active',       ctrl.getActive);
router.post  ('/calculate',    ctrl.calculate);    // legacy

// Advanced campaign engine — Pro+
router.post  ('/apply',        checkPlanFeature('campaign_advanced'), ctrl.applyToCart);

router.get   ('/:id',          ctrl.getById);
router.post  ('/',             ctrl.create);
router.put   ('/:id',          ctrl.update);
router.patch ('/:id/toggle',   ctrl.toggle);
router.delete('/:id',          ctrl.delete);

// Rule CRUD — Pro+ (advanced campaign rules)
router.post  ('/:id/rules',              checkPlanFeature('campaign_advanced'), ctrl.addRule);
router.put   ('/:id/rules/:ruleId',      checkPlanFeature('campaign_advanced'), ctrl.updateRule);
router.delete('/:id/rules/:ruleId',      checkPlanFeature('campaign_advanced'), ctrl.deleteRule);

export default router;
