import { Router } from 'express';
import {
  listMarketplaceQuestions,
  getMarketplaceQuestionStats,
  getMarketplaceQuestion,
  syncMarketplaceQuestions,
  answerMarketplaceQuestion,
} from './marketplace-question.controller';

const router = Router();

router.get   ('/',           listMarketplaceQuestions);
router.get   ('/stats',      getMarketplaceQuestionStats);
router.post  ('/sync',       syncMarketplaceQuestions);
router.get   ('/:id',        getMarketplaceQuestion);
router.post  ('/:id/answer', answerMarketplaceQuestion);

export default router;
