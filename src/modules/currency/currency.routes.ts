import { Router } from 'express';
import { currencyController } from './currency.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();

// Public routes
router.get('/supported', currencyController.getSupportedCurrencies.bind(currencyController));
router.post('/convert', currencyController.convert.bind(currencyController));

// Protected routes
router.use(authenticate);

router.get('/rates', currencyController.getRates.bind(currencyController));
router.post('/update', currencyController.updateRates.bind(currencyController));

export default router;
