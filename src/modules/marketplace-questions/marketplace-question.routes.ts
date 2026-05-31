import { Router } from 'express';
import {
  listMarketplaceQuestions,
  getMarketplaceQuestion,
  syncMarketplaceQuestions,
  answerMarketplaceQuestion,
} from './marketplace-question.controller';

const router = Router();

router.get   ('/',           listMarketplaceQuestions);
router.post  ('/sync',       syncMarketplaceQuestions);
router.get   ('/:id',        getMarketplaceQuestion);
router.post  ('/:id/answer', answerMarketplaceQuestion);

export default router;
