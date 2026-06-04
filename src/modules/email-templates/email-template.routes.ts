import { Router } from 'express';
import * as ctrl from './email-template.controller';

const router = Router();

router.get('/', ctrl.listEmailTemplates);
router.post('/', ctrl.createEmailTemplate);
router.get('/:key', ctrl.getEmailTemplate);
router.put('/:key', ctrl.updateEmailTemplate);
router.delete('/:key', ctrl.deleteEmailTemplate);

export default router;
