import { Router } from 'express';
import { mobileController } from './mobile.controller';
import { authenticate } from '../../common/middleware/authEnhanced';
import { rateLimits } from '../../middleware/security.middleware';

const router = Router();

// Public routes (no authentication required)
router.get('/config', mobileController.getConfig.bind(mobileController));
router.get('/products', rateLimits.general, mobileController.getProducts.bind(mobileController));
router.get('/categories', rateLimits.general, mobileController.getCategories.bind(mobileController));

// Protected routes (authentication required)
router.use(authenticate);

router.get('/profile', mobileController.getProfile.bind(mobileController));
router.post('/orders', rateLimits.general, mobileController.createOrder.bind(mobileController));
router.get('/orders', mobileController.getOrders.bind(mobileController));
router.get('/notifications', mobileController.getNotifications.bind(mobileController));
router.post('/notifications/read', mobileController.markNotificationRead.bind(mobileController));
router.get('/wishlist', mobileController.getWishlist.bind(mobileController));
router.post('/wishlist/add', mobileController.addToWishlist.bind(mobileController));
router.post('/wishlist/remove', mobileController.removeFromWishlist.bind(mobileController));

export default router;
