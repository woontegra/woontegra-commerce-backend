import express, { Application } from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler, asyncHandler } from './common/middleware/errorHandler';
import { requestIdMiddleware } from './common/middleware/requestId';
import { rateLimitConfigs, createRateLimit } from './common/middleware/rateLimit.middleware';
import { authenticate, optionalAuth, requireTenantAccess } from './common/middleware/authEnhanced';
import { setupGracefulShutdown, setupMemoryMonitoring, setupCPUMonitoring, healthCheck } from './utils/gracefulShutdown';
import {
  apiLimiter,
  authLimiter,
  sanitizeInput,
  requestSizeLimiter,
} from './common/middleware/security.middleware';

import authRoutes from './modules/auth/auth.routes';
import tenantRoutes from './modules/tenants/tenant.routes';
import productRoutes from './modules/products/product.routes';
import customerRoutes from './modules/customers/customer.routes';
import categoryRoutes from './modules/categories/category.routes';
import brandRoutes from './modules/brands/brand.routes';
import orderRoutes from './modules/orders/order.routes';
import settingsRoutes from './modules/settings/settings.routes';
import planRoutes from './modules/plan/plan.routes';
import supportRoutes from './modules/support/support.routes';
import seoRoutes from './modules/seo/seo.routes';
import { marketplaceRoutes } from './modules/marketplace/marketplace.routes';
import marketplaceHubRoutes from './modules/marketplace/core/services/marketplace-hub.routes';
import billingRoutes from './modules/billing/billing.routes';
import adminRoutes from './modules/admin/admin.routes';
import { tenantLifecycleGuard } from './modules/lifecycle/lifecycle.middleware';
import { startLifecycleCron } from './modules/lifecycle/lifecycle.cron';
import featureRoutes from './modules/features/feature.routes';
import { FeatureService } from './modules/features/feature.service';
import notificationRoutes from './modules/notifications/notification.routes';
import searchRoutes from './modules/search/search.routes';
import csvRoutes        from './modules/csv/csv.routes';
import permissionRoutes from './modules/permissions/permission.routes';
import webhookRoutes   from './modules/webhooks/webhook.routes';
import publicApiRouter from './modules/api/public/index';
import apiTokenRoutes   from './modules/api/tokens.routes';
import './modules/webhooks/webhook.handlers';    // register eventBus → webhook bridges
// Register event handlers (side-effect import — handlers wire eventBus)
import './modules/notifications/notification.handlers';
import attributeRoutes          from './modules/attributes/attribute.routes';
import categoryAttributeRoutes  from './modules/attributes/category-attribute.routes';
import campaignRoutes           from './modules/campaigns/campaign.routes';
import couponRoutes             from './modules/coupons/coupon.routes';
import trendyolRoutes          from './modules/trendyol/trendyol.routes';
import reportsRoutes           from './modules/reports/reports.routes';
import b2bRoutes               from './modules/b2b/b2b.routes';
import wishlistRoutes          from './modules/wishlist/wishlist.routes';
import popupRoutes             from './modules/popups/popup.routes';
import shippingRuleRoutes      from './modules/shipping/shipping-rule.routes';
import taxRoutes               from './modules/tax/tax.routes';
import storeRoutes             from './modules/stores/store.routes';
import translationRoutes       from './modules/translations/translation.routes';
import currencyRoutes          from './modules/currency/currency.routes';
import analyticsRoutes         from './modules/analytics/analytics.routes';
import exportRoutes            from './modules/export/export.routes';
import apiKeyRoutes            from './modules/api-keys/api-key.routes';
import uploadOptimizedRoutes   from './modules/upload/upload-optimized.routes';
import batchRoutes             from './modules/batch/batch.routes';
import superAdminRoutes        from './modules/superadmin/superadmin.routes';
import invoiceRoutes           from './modules/billing/invoice.routes';
import stockSyncRoutes          from './modules/stock/stock-sync.routes';
import { pingMeilisearch } from './config/meilisearch';
import { searchService }   from './modules/search/search.service';
import { initializeQueues, closeQueues } from './queues';
import { bullBoardRouter } from './queues/bull-board';

const app: Application = express();

// Setup graceful shutdown and monitoring
setupGracefulShutdown();
setupMemoryMonitoring();
setupCPUMonitoring();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https:'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// CORS configuration with strict domain validation
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://woontegra.com',
      'https://www.woontegra.com',
    ];
    
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    
    // Log CORS violation
    logger.warn({
      message: 'CORS violation',
      origin,
      path: 'unknown',
      timestamp: new Date().toISOString(),
    });
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
}));

// Request size and sanitization
app.use(requestSizeLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(sanitizeInput);

// Request ID and logging
app.use(requestIdMiddleware);

// Apply rate limiting to auth endpoints
app.use('/api/auth/register', createRateLimit(rateLimitConfigs.registration));
app.use('/api/auth/login', createRateLimit(rateLimitConfigs.auth));

// General rate limiting
app.use('/api/', apiLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Woontegra E-Commerce SaaS API is running',
    data: healthCheck(),
    timestamp: new Date().toISOString(),
  });
});

// API routes with authentication
app.use('/api/auth', authRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/features',       featureRoutes);
app.use('/api/notifications',  notificationRoutes);
app.use('/api/search',         searchRoutes);
app.use('/api/csv',            csvRoutes);
app.use('/api/permissions',    permissionRoutes);
app.use('/api/api-tokens',     apiTokenRoutes);
app.use('/api/webhooks',       webhookRoutes);
app.use('/api/v1',             publicApiRouter);  // Public REST API (API token auth)
app.use('/api/support', supportRoutes);
app.use('/api/seo', seoRoutes);
app.use('/api/marketplace', marketplaceRoutes);

// Protected routes with authentication, tenant isolation + lifecycle guard
app.use('/api/tenants',   authenticate, requireTenantAccess, tenantLifecycleGuard, tenantRoutes);
app.use('/api/products',  authenticate, requireTenantAccess, tenantLifecycleGuard, productRoutes);
app.use('/api/customers', authenticate, requireTenantAccess, tenantLifecycleGuard, customerRoutes);
app.use('/api/categories', authenticate, requireTenantAccess, tenantLifecycleGuard, categoryRoutes);
app.use('/api/brands',    authenticate, requireTenantAccess, tenantLifecycleGuard, brandRoutes);
app.use('/api/attributes',         authenticate, requireTenantAccess, attributeRoutes);
app.use('/api/category-attributes', authenticate, requireTenantAccess, categoryAttributeRoutes);
app.use('/api/orders',    authenticate, requireTenantAccess, tenantLifecycleGuard, orderRoutes);
app.use('/api/campaigns', authenticate, requireTenantAccess, tenantLifecycleGuard, campaignRoutes);
app.use('/api/coupons',   authenticate, requireTenantAccess, couponRoutes);
app.use('/api/trendyol',        authenticate, requireTenantAccess, trendyolRoutes);
app.use('/api/marketplace-hub', authenticate, requireTenantAccess, marketplaceHubRoutes);
app.use('/api/b2b',             authenticate, requireTenantAccess, tenantLifecycleGuard, b2bRoutes);
app.use('/api/wishlist',        authenticate, requireTenantAccess, wishlistRoutes);
app.use('/api/popups',          authenticate, requireTenantAccess, popupRoutes);
app.use('/api/shipping-rules',  authenticate, requireTenantAccess, shippingRuleRoutes);
app.use('/api/tax',             taxRoutes);  // Public routes for calculation
app.use('/api/stores',          authenticate, requireTenantAccess, storeRoutes);
app.use('/api/translations',    translationRoutes);  // Auth applied inside router
app.use('/api/currency',        currencyRoutes);  // Auth applied inside router
app.use('/api/analytics',       authenticate, requireTenantAccess, analyticsRoutes);
app.use('/api/export',          authenticate, requireTenantAccess, exportRoutes);
app.use('/api/api-keys',        authenticate, requireTenantAccess, apiKeyRoutes);
app.use('/api/upload-optimized', authenticate, requireTenantAccess, uploadOptimizedRoutes);
app.use('/api/batch',           authenticate, requireTenantAccess, batchRoutes);
app.use('/api/superadmin',      superAdminRoutes); // Auth + SuperAdmin middleware inside
app.use('/api/invoices',        authenticate, invoiceRoutes); // Auth inside router
app.use('/api/stock-sync',      authenticate, stockSyncRoutes); // Auth inside router
app.use('/admin/queues', authenticate, bullBoardRouter); // Bull Board dashboard
app.use('/api/reports',  reportsRoutes);   // authenticate is applied inside the router
// Static uploads — Cross-Origin-Resource-Policy must be "cross-origin" so the
// frontend (localhost:5173) can load images served by the API (localhost:3000).
// Helmet sets "same-origin" globally; we override it here for /uploads only.
app.use('/uploads', (_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(process.cwd(), 'uploads')));

// Settings: public /api/settings/branding/:slug + protected rest
app.use('/api/settings', settingsRoutes);

// Optional auth routes (for public endpoints that might have user context)
app.use('/api/public', optionalAuth);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start lifecycle cron
startLifecycleCron();

// Meilisearch: connect + setup index (non-blocking)
pingMeilisearch().then(ok => {
  if (ok) searchService.setupIndex().catch(() => {});
});

// Sync feature definitions on startup (idempotent)
new FeatureService().syncFeatureDefinitions().catch((err) =>
  logger.error({ message: 'Feature sync failed', err }),
);

// Start server
const server = app.listen(config.port, async () => {
  const message = `
╔══════════════════════════════════════════════════╗
║                                                           ║
║   🚀 Woontegra E-Commerce SaaS Backend                   ║
║                                                           ║
║   Server running on: http://localhost:${config.port}            ║
║   Environment: ${config.nodeEnv}                              ║
║   Process ID: ${process.pid}                                   ║
║                                                           ║
╚════════════════════════════════════════════════════╝
  `;
  console.log(message);
  logger.info({
    message: 'Server started successfully',
    port: config.port,
    environment: config.nodeEnv,
    pid: process.pid,
    timestamp: new Date().toISOString(),
  });

  // Initialize queues
  await initializeQueues();
});

// Handle server errors
server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    logger.error({
      message: `Port ${config.port} is already in use`,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  } else {
    logger.error({
      message: 'Server error',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
  }
});

// Handle server shutdown gracefully
server.on('close', async () => {
  logger.info({
    message: 'Server closing...',
    timestamp: new Date().toISOString(),
  });

  // Close queues
  await closeQueues();

  logger.info({
    message: 'Server closed',
    timestamp: new Date().toISOString(),
  });
});

export default app;
