import { Router } from 'express';
import { uploadOptimizedController, uploadSingleMiddleware, uploadMultipleMiddleware } from './upload-optimized.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.post('/single', uploadSingleMiddleware, uploadOptimizedController.uploadSingle.bind(uploadOptimizedController));
router.post('/multiple', uploadMultipleMiddleware, uploadOptimizedController.uploadMultiple.bind(uploadOptimizedController));

export default router;
