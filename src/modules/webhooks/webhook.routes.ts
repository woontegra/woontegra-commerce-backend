import { Router } from 'express';
import { authenticate } from '../../common/middleware/authEnhanced';
import { checkPlanFeature } from '../features/feature.middleware';
import {
  listWebhooks, listEvents, createWebhook,
  getWebhook, updateWebhook, deleteWebhook,
  rotateSecret, testWebhook, getWebhookLogs,
} from './webhook.controller';

const router = Router();
router.use(authenticate);
router.use(checkPlanFeature('webhooks'));

router.get('/',                    listWebhooks    as any);
router.get('/events',              listEvents);
router.post('/',                   createWebhook   as any);
router.get('/:id',                 getWebhook      as any);
router.put('/:id',                 updateWebhook   as any);
router.delete('/:id',              deleteWebhook   as any);
router.post('/:id/rotate-secret',  rotateSecret    as any);
router.post('/:id/test',           testWebhook     as any);
router.get('/:id/logs',            getWebhookLogs  as any);

export default router;
