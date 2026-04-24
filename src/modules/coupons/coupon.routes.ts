import { Router } from 'express';
import { CouponController } from './coupon.controller';

// Auth + tenant guard applied globally in main.ts for /api/coupons
const router = Router();
const ctrl   = new CouponController();

router.get('/',             ctrl.getAll);
router.get('/stats',        ctrl.getStats);
router.post('/validate',    ctrl.validate);
router.get('/:id',          ctrl.getById);
router.post('/',            ctrl.create);
router.put('/:id',          ctrl.update);
router.patch('/:id/toggle', ctrl.toggle);
router.delete('/:id',       ctrl.delete);

export default router;
