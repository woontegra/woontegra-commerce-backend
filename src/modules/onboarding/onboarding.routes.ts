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
router.post('/dismiss', requireAuth(), onboardingController.dismissOnboarding);
router.post('/reopen', requireAuth(), onboardingController.reopenOnboarding);

// ─── NEW ONBOARDING WIZARD ROUTES ───────────────────────────────────────────
// GET /api/onboarding/wizard/status - Get current wizard status
router.get('/wizard/status', requireAuth(), onboardingController.getOnboardingWizardStatus);

// POST /api/onboarding/theme - STEP 1: Save theme selection
router.post('/theme', requireAuth(), onboardingController.saveTheme);

// POST /api/onboarding/store-info - STEP 2: Save store info
router.post('/store-info', requireAuth(), onboardingController.saveStoreInfo);

// POST /api/onboarding/product - STEP 3: Create first product
router.post('/product', requireAuth(), onboardingController.createFirstProduct);

// POST /api/onboarding/complete-wizard - STEP 4: Complete onboarding
router.post('/complete-wizard', requireAuth(), onboardingController.completeOnboardingWizard);

export default router;
