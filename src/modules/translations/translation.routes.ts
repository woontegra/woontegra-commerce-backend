import { Router } from 'express';
import { translationController } from './translation.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();

// Public routes
router.get('/languages', translationController.getSupportedLanguages.bind(translationController));

// Protected routes
router.use(authenticate);

router.get('/products/:productId', translationController.getProductTranslations.bind(translationController));
router.post('/products/:productId', translationController.upsertTranslation.bind(translationController));
router.delete('/products/:productId/:language', translationController.deleteTranslation.bind(translationController));

export default router;
