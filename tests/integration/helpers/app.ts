import express, { Application } from 'express';
import { authenticate, requireTenantAccess } from '../../../src/common/middleware/authEnhanced';
import { errorHandler } from '../../../src/common/middleware/errorHandler';
import productRoutes from '../../../src/modules/products/product.routes';
import billingRoutes from '../../../src/modules/billing/billing.routes';

/**
 * Integration testler için minimal Express uygulaması (supertest).
 */
export function buildIntegrationApp(): Application {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use('/api/products', authenticate, requireTenantAccess, productRoutes);
  app.use('/api/billing', billingRoutes);

  app.use(errorHandler);

  return app;
}
