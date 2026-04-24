import { Router } from 'express';
import { demoController } from './demo.controller';
import { DemoMiddleware } from '../../common/middleware/demo.middleware';

const router = Router();

// Get demo session info
router.get('/session', demoController.getDemoSession);

// Start demo session
router.post('/start', demoController.startDemoSession);

// End demo session
router.post('/end', demoController.endDemoSession);

// Apply demo session requirement for demo routes
router.use(DemoMiddleware.createDemoSession);

export default router;
