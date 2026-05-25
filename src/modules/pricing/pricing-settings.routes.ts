import { Router } from 'express';
import { PricingSettingsController } from './pricing-settings.controller';

const router = Router();
const ctrl = new PricingSettingsController();

router.get('/', ctrl.get);
router.post('/', ctrl.save);

export default router;
