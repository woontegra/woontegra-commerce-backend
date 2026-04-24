import { Router, Request, Response } from 'express';
import { PublicProductsController  } from './products.controller';
import { PublicOrdersController    } from './orders.controller';
import { PublicCustomersController } from './customers.controller';
import { apiAuth, requireScope    } from '../../../middleware/apiAuth';

const router = Router();

// ── Auth on all /api/v1 routes ────────────────────────────────────────────────
router.use(apiAuth);

// ── Meta ──────────────────────────────────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    version: '1.0',
    docs:    'https://docs.woontegra.com/api',
    endpoints: [
      'GET  /api/v1/products',
      'GET  /api/v1/products/:id',
      'GET  /api/v1/orders',
      'POST /api/v1/orders',
      'GET  /api/v1/orders/:id',
      'GET  /api/v1/customers',
      'POST /api/v1/customers',
      'GET  /api/v1/customers/:id',
    ],
  });
});

// ── Products ──────────────────────────────────────────────────────────────────
const products = new PublicProductsController();
router.get('/products',    requireScope('products:read'), (req, res) => products.list(req as any, res));
router.get('/products/:id', requireScope('products:read'), (req, res) => products.getById(req as any, res));

// ── Orders ────────────────────────────────────────────────────────────────────
const orders = new PublicOrdersController();
router.post('/orders',     requireScope('orders:write'), (req, res) => orders.create(req as any, res));
router.get('/orders',      requireScope('orders:read'),  (req, res) => orders.list(req as any, res));
router.get('/orders/:id',  requireScope('orders:read'),  (req, res) => orders.getById(req as any, res));

// ── Customers ─────────────────────────────────────────────────────────────────
const customers = new PublicCustomersController();
router.get('/customers',    requireScope('customers:read'),  (req, res) => customers.list(req as any, res));
router.get('/customers/:id', requireScope('customers:read'), (req, res) => customers.getById(req as any, res));
router.post('/customers',   requireScope('customers:write'), (req, res) => customers.create(req as any, res));

export default router;
