import express, { Application } from 'express';
import cors from 'cors';
import { config } from './config/env';
import { errorHandler } from './common/middleware/error.middleware';

import authRoutes from './modules/auth/auth.routes';
import tenantRoutes from './modules/tenants/tenant.routes';
import productRoutes from './modules/products/product.routes';
import customerRoutes from './modules/customers/customer.routes';

const app: Application = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Woontegra E-Commerce SaaS API is running',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customers', customerRoutes);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 Woontegra E-Commerce SaaS Backend                   ║
║                                                           ║
║   Server running on: http://localhost:${config.port}            ║
║   Environment: ${config.nodeEnv}                        ║
║   Multi-tenant: ✅ Enabled                               ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export default app;
