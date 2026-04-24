import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../../common/middleware/authEnhanced';
import { searchProducts, getSearchFacets, reindexProducts } from './search.controller';
import { LiveSearchController } from './live-search.controller';

const router = Router();
const prisma = new PrismaClient();
const liveSearchCtrl = new LiveSearchController(prisma);

router.use(authenticate);

// Live search endpoint (no cache for real-time results)
router.get('/live', liveSearchCtrl.search.bind(liveSearchCtrl));

router.get('/products',         searchProducts);
router.get('/products/facets',  getSearchFacets);
router.post('/products/reindex', reindexProducts);

export default router;
