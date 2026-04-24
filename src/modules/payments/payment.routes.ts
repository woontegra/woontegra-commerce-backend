import { Router } from 'express';
import { PaymentController } from './payment.controller';

const router = Router();
const paymentController = new PaymentController();

router.post('/process', (req, res) => paymentController.processPayment(req, res));
router.post('/refund', (req, res) => paymentController.refundPayment(req, res));

export default router;
