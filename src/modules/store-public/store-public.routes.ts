import { Router } from 'express';
import express from 'express';
import { createRateLimit } from '../../common/middleware/rateLimit.middleware';
import * as ctrl from './store-public.controller';

const bankTransferResendEmailLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Çok fazla istek. Lütfen daha sonra tekrar deneyin.',
  standardHeaders: true,
  legacyHeaders: false,
});
import * as payCtrl from './store-payment.controller';
import * as shipCtrl from './store-shipping.controller';
import * as authCtrl from './store-customer-auth.controller';
import * as favCtrl from './store-favorites.controller';
import * as returnCtrl from './store-return-request.controller';
import { requireStoreCustomer, optionalStoreCustomer } from './store-customer-auth.middleware';

const router = Router();

router.post('/auth/register', authCtrl.register);
router.post('/auth/login', authCtrl.login);
router.post('/auth/logout', authCtrl.logout);
router.post('/auth/forgot-password', authCtrl.forgotPassword);
router.post('/auth/reset-password', authCtrl.resetPassword);
router.get('/auth/me', requireStoreCustomer, authCtrl.me);

router.put('/account/profile', requireStoreCustomer, authCtrl.updateProfile);
router.get('/account/orders', requireStoreCustomer, authCtrl.listMyOrders);
router.get('/account/orders/summary', requireStoreCustomer, authCtrl.getMyOrdersSummary);
router.get('/account/orders/:orderNumber', requireStoreCustomer, authCtrl.getMyOrder);
router.get('/account/addresses', requireStoreCustomer, authCtrl.listAddresses);
router.post('/account/addresses', requireStoreCustomer, authCtrl.createAddress);
router.put('/account/addresses/:id', requireStoreCustomer, authCtrl.updateAddress);
router.delete('/account/addresses/:id', requireStoreCustomer, authCtrl.deleteAddress);

router.get('/account/favorites', requireStoreCustomer, favCtrl.listFavorites);
router.post('/account/favorites', requireStoreCustomer, favCtrl.addFavorite);
router.delete('/account/favorites/:productId', requireStoreCustomer, favCtrl.removeFavorite);

router.get('/account/returns', requireStoreCustomer, returnCtrl.listMyReturns);
router.get('/account/returns/:id', requireStoreCustomer, returnCtrl.getMyReturn);
router.post('/account/orders/:orderNumber/return-request', requireStoreCustomer, returnCtrl.createReturnRequest);

router.get('/products', ctrl.listProducts);
router.get('/products/:slug', ctrl.getProductBySlug);
router.get('/categories', ctrl.listCategories);
router.get('/payments/methods', ctrl.listStorePaymentMethods);
router.post('/shipping/calculate', shipCtrl.calculateStoreShipping);
router.post('/orders', optionalStoreCustomer, ctrl.createStoreOrder);
router.get('/orders/:orderNumber/status', ctrl.getStoreOrderStatus);
router.get('/orders/:orderNumber/payment-pending', ctrl.getStoreOrderPaymentPending);
router.post(
  '/orders/:orderNumber/payment-pending/resend-email',
  bankTransferResendEmailLimit,
  ctrl.resendStoreOrderPaymentPendingEmail,
);

router.post('/payments/paytr/start', payCtrl.startPaytrPayment);
router.post('/payments/iyzico/start', payCtrl.startIyzicoPayment);
router.post(
  '/payments/paytr/callback',
  express.urlencoded({ extended: false }),
  payCtrl.paytrCallback,
);
router.post(
  '/payments/iyzico/callback',
  express.urlencoded({ extended: false }),
  payCtrl.iyzicoCallback,
);

export default router;
