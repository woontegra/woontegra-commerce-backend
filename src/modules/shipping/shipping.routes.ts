import { Router } from 'express';
import { ShippingController } from './shipping.controller';

const router = Router();
const shippingController = new ShippingController();

router.get('/', (req, res) => shippingController.getAll(req, res));
router.get('/:id', (req, res) => shippingController.getById(req, res));
router.post('/', (req, res) => shippingController.create(req, res));
router.put('/:id', (req, res) => shippingController.update(req, res));
router.delete('/:id', (req, res) => shippingController.delete(req, res));

export default router;
