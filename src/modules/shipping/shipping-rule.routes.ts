import { Router } from 'express';
import { shippingRuleController } from './shipping-rule.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Calculate shipping cost (public for checkout)
router.post('/calculate', shippingRuleController.calculate.bind(shippingRuleController));

// Admin routes
router.get('/', shippingRuleController.getAll.bind(shippingRuleController));
router.get('/:id', shippingRuleController.getById.bind(shippingRuleController));
router.post('/', shippingRuleController.create.bind(shippingRuleController));
router.put('/:id', shippingRuleController.update.bind(shippingRuleController));
router.delete('/:id', shippingRuleController.delete.bind(shippingRuleController));
router.patch('/:id/toggle', shippingRuleController.toggleActive.bind(shippingRuleController));

export default router;
