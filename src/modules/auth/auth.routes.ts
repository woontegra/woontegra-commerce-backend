import { Router } from 'express';
import { AuthController } from './auth.controller';
import { OnboardingController } from '../onboarding/onboarding.controller';
import { validate, schemas } from '../../common/middleware/validation.middleware';
import { rateLimitConfigs, createRateLimit } from '../../common/middleware/rateLimit.middleware';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();
const authController = new AuthController();
const onboardingController = new OnboardingController();

const registerRateLimit = createRateLimit(rateLimitConfigs.auth);
const loginRateLimit    = createRateLimit(rateLimitConfigs.auth);

// Auth routes
router.post('/register',      validate(schemas.register), registerRateLimit, authController.register);
router.post('/login',         validate(schemas.login),    loginRateLimit,    authController.login);
router.post('/saas-register', validate(schemas.register), registerRateLimit, authController.saasRegister);
router.get( '/me',           authenticate, authController.me);

// Onboarding routes (inline — OnboardingController has no getRoutes())
router.post('/onboarding/register-tenant', onboardingController.registerTenant);
router.post('/onboarding/register-user',   onboardingController.registerUser);
router.get( '/onboarding/status',          authenticate, onboardingController.getOnboardingStatus);
router.put( '/onboarding/step',            authenticate, onboardingController.updateOnboardingStep);
router.post('/onboarding/complete',        authenticate, onboardingController.completeOnboarding);

export default router;
