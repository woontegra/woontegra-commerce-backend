import { Router } from 'express';
import * as ctrl from './xml-source.controller';

const router = Router();

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id', ctrl.getOne);
router.post('/:id/preview', ctrl.previewFields);
router.patch('/:id', ctrl.patch);
router.delete('/:id', ctrl.remove);
router.post('/:id/sync', ctrl.sync);

export default router;
