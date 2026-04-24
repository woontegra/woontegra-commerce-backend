import { Router } from 'express';
import { OnboardingController } from './onboarding.controller';
import { requireAuth } from '../../common/middleware/authGuard.middleware';
import { rateLimitConfigs, createRateLimit } from '../../common/middleware/rateLimit.middleware';

const router = Router();
const onboardingController = new OnboardingController();

// Apply rate limiting to registration endpoints
const registerTenantRateLimit = createRateLimit(rateLimitConfigs.auth);
const registerUserRateLimit = createRateLimit(rateLimitConfigs.auth);

// Public routes (no auth required)
router.post('/register-tenant', registerTenantRateLimit, onboardingController.registerTenant);
router.post('/register-user', registerUserRateLimit, onboardingController.registerUser);

// Protected routes (auth required)
router.get('/status', requireAuth(), onboardingController.getOnboardingStatus);
router.post('/next', requireAuth(), onboardingController.updateOnboardingStep);
router.post('/complete', requireAuth(), onboardingController.completeOnboarding);

export default router;
