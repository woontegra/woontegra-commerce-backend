import { Router } from 'express';
import { BrandController } from './brand.controller';

const router = Router();
const ctrl   = new BrandController();

router.get ('/',                   ctrl.getAll);
router.post('/',                   ctrl.create);
router.get ('/stats',              ctrl.getStats);
router.post('/merge',              ctrl.merge);        // before /:id
router.get ('/:id',                ctrl.getById);
router.put ('/:id',                ctrl.update);
router.delete('/:id',              ctrl.delete);
router.post('/:id/assign',         ctrl.assign);       // assign brand to products by category

export default router;
