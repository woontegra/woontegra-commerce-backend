import { Router } from 'express';
import { authenticateApiToken, requireApiPermission, checkApiRateLimit } from '../middleware/apiAuth.middleware';
import * as productController from '../controllers/public/product.controller';
import * as orderController from '../controllers/public/order.controller';

const router = Router();

// Apply API authentication to all public API routes
router.use(authenticateApiToken);
router.use(checkApiRateLimit);

// Product endpoints
router.get('/products', requireApiPermission('products:read'), productController.getProducts);
router.get('/products/:id', requireApiPermission('products:read'), productController.getProduct);
router.post('/products', requireApiPermission('products:write'), productController.createProduct);
router.put('/products/:id', requireApiPermission('products:write'), productController.updateProduct);

// Order endpoints
router.get('/orders', requireApiPermission('orders:read'), orderController.getOrders);
router.get('/orders/:id', requireApiPermission('orders:read'), orderController.getOrder);
router.put('/orders/:id', requireApiPermission('orders:write'), orderController.updateOrder);

export default router;
