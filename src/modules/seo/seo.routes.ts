import { Router } from 'express';
import { SEOController } from './seo.controller';
import { authenticate, requireTenantAccess } from '../../common/middleware/authEnhanced';
import { rateLimitConfigs, createRateLimit } from '../../common/middleware/rateLimit.middleware';

const router = Router();
const seoController = new SEOController();

// Public SEO routes (no authentication required)
router.get('/store/:tenantSlug', seoController.getStoreBySlug);
router.get('/store/:tenantSlug/product/:productSlug', seoController.getProductBySlug);
router.get('/store/:tenantSlug/category/:categorySlug', seoController.getCategoryBySlug);
router.get('/sitemap/:tenantSlug.xml', seoController.generateSitemap);
router.get('/robots/:tenantSlug.txt', seoController.generateRobotsTxt);

// Apply rate limiting to SEO endpoints
const seoRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all SEO routes
router.use(seoRateLimit);

export default router;
