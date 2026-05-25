import { Router } from 'express';
import { PricingRuleController } from './pricing-rule.controller';

const router = Router();
const ctrl = new PricingRuleController();

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
