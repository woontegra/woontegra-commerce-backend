import { Router } from 'express';
import { ApiTokensController } from './tokens.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();
const tokensController = new ApiTokensController();

// All routes require authentication
router.use(authenticate);

router.get('/', tokensController.list.bind(tokensController));
router.post('/', tokensController.create.bind(tokensController));
router.patch('/:id', tokensController.update.bind(tokensController));
router.delete('/:id', tokensController.delete.bind(tokensController));

export default router;
