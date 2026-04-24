import { Router } from 'express';
import { PlanController } from './plan.controller';
import { requireAuth } from '../../common/middleware/authGuard.middleware';
import { rateLimitConfigs, createRateLimit } from '../../common/middleware/rateLimit.middleware';

const router = Router();
const planController = new PlanController();

// Apply rate limiting to plan endpoints
const planRateLimit = createRateLimit(rateLimitConfigs.auth);

// Get all plans (public)
router.get('/', planRateLimit, planController.getPlans);

// Get plan by slug (public)
router.get('/:slug', planRateLimit, planController.getPlanBySlug);

// Protected routes (auth required)
router.use('/', requireAuth(), planController.createSubscription);
router.get('/subscription', requireAuth(), planController.getUserSubscription);
router.post('/cancel', requireAuth(), planController.cancelSubscription);
router.post('/change-plan', requireAuth(), planController.changePlan);

export default router;
