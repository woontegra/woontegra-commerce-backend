import { Router } from 'express';
import { CategoryController } from './category.controller';
import { authMiddleware } from '../../common/middleware/auth.middleware';
import { tenantMiddleware } from '../../common/middleware/tenant.middleware';
import { AttributeController } from '../attributes/attribute.controller';

const router    = Router();
const ctrl      = new CategoryController();
const attrCtrl  = new AttributeController();

router.use(authMiddleware);
router.use(tenantMiddleware);

// ── Special routes (before /:id to avoid param collision) ─────────────────────
router.get   ('/tree',      ctrl.getTree);       // nested tree
router.get   ('/flat',      ctrl.getFlat);       // flat list with depth info
router.post  ('/reorder',   ctrl.reorder);       // bulk reorder
router.delete('/bulk',      ctrl.bulkDelete);    // bulk delete

// ── CRUD ──────────────────────────────────────────────────────────────────────
router.get ('/',          ctrl.getAll);      // flat legacy list
router.post('/',          ctrl.create);
router.get ('/:id',        ctrl.getById);
router.put ('/:id',        ctrl.update);
router.delete('/:id',      ctrl.delete);     // ?force=true for force delete

// ── Sub-resources ─────────────────────────────────────────────────────────────
router.get ('/:id/breadcrumb',   ctrl.getBreadcrumb);
router.get ('/:id/descendants',  ctrl.getDescendants);
router.get ('/:id/products',     ctrl.getProducts);          // ?descendants=true
router.get ('/:categoryId/attributes', attrCtrl.getCategoryAttributes); // shortcut

export default router;
