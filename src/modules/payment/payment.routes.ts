import { Router } from 'express';
import { paymentController } from './payment.controller';
import { authenticateToken } from '../../common/middleware/auth.middleware';

const router = Router();

// Apply authentication to all payment routes
router.use(authenticateToken);

// Process payment
router.post('/process', paymentController.processPayment);

// Upgrade plan
router.post('/upgrade', paymentController.upgradePlan);

// Get payment methods
router.get('/methods', paymentController.getPaymentMethods);

// Delete payment method
router.delete('/methods', paymentController.deletePaymentMethod);

// Get billing history
router.get('/billing-history', paymentController.getBillingHistory);

// Apply plan requirements
router.use('/upgrade', paymentController.requireProPlan);
router.use('/process', paymentController.requireProPlan);

export default router;
