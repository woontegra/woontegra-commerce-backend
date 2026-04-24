import { Router } from 'express';
import { taxController } from './tax.controller';

const router = Router();

// Public routes (no auth required for calculation)
router.post('/calculate', taxController.calculate.bind(taxController));
router.post('/breakdown', taxController.breakdown.bind(taxController));
router.get('/rates', taxController.getRates.bind(taxController));

export default router;
