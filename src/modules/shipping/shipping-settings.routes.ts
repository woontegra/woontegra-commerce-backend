import { Router } from 'express';
import * as ctrl from './shipping-settings.controller';

const router = Router();

router.get('/', ctrl.getShippingSettings);
router.put('/', ctrl.upsertShippingSettings);

export default router;
