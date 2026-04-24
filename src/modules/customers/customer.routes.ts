import { Router } from 'express';
import { CustomerController } from './customer.controller';
import { validate, schemas } from '../../common/middleware/validation.middleware';

// Auth + tenant guard applied globally in main.ts for /api/customers
const router = Router();
const ctrl   = new CustomerController();

router.get('/',       ctrl.getAll);
router.get('/stats',  ctrl.getStats);
router.get('/:id',    ctrl.getById);
router.post('/',      validate(schemas.createCustomer), ctrl.create);
router.put('/:id',    ctrl.update);
router.delete('/:id', ctrl.delete);

export default router;
