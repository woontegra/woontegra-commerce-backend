import { Router } from 'express';
import { apiKeyController } from './api-key.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.post('/', apiKeyController.createApiKey.bind(apiKeyController));
router.get('/', apiKeyController.getApiKeys.bind(apiKeyController));
router.put('/:id', apiKeyController.updateApiKey.bind(apiKeyController));
router.post('/:id/revoke', apiKeyController.revokeApiKey.bind(apiKeyController));
router.delete('/:id', apiKeyController.deleteApiKey.bind(apiKeyController));

export default router;
