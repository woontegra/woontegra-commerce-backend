import { Router } from 'express';
import { subscriptionController } from './subscription.controller';
import { authenticateToken } from '../../common/middleware/auth.middleware';
import { checkPlanLimits } from '../../common/middleware/planCheck.middleware';

const router = Router();

// Apply authentication to all subscription routes
router.use(authenticateToken);

// Get current usage stats
router.get('/usage', subscriptionController.getUsageStats);

// Get current plan details
router.get('/current', subscriptionController.getCurrentPlan);

// Upgrade plan
router.post('/upgrade', subscriptionController.upgradePlan);

// Check plan limits before actions
router.post('/check-limits', checkPlanLimits, (req, res) => {
  res.json({ message: 'Plan limits check middleware applied' });
});

export default router;
