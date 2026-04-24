import { Router } from 'express';
import { AttributeController } from './attribute.controller';
import { authMiddleware } from '../../common/middleware/auth.middleware';
import { tenantMiddleware } from '../../common/middleware/tenant.middleware';

const router = Router();
const ctrl   = new AttributeController();

router.use(authMiddleware);
router.use(tenantMiddleware);

// ── Attribute CRUD ─────────────────────────────────────────────────────────────
router.get  ('/',    ctrl.getAll);
router.post ('/',    ctrl.create);
router.get  ('/:id', ctrl.getById);
router.put  ('/:id', ctrl.update);
router.delete('/:id', ctrl.delete);

// ── Attribute values ───────────────────────────────────────────────────────────
router.post  ('/:id/values',           ctrl.addValue);
router.delete('/:id/values/:valueId',  ctrl.deleteValue);

// ── Category-level attribute management ────────────────────────────────────────
// GET  /attributes/categories/:categoryId          → list attributes for category
// POST /attributes/categories/:categoryId          → assign attribute to category
// DELETE /attributes/categories/:categoryId/:attrId → remove attribute from category
// POST /attributes/categories/:categoryId/reorder  → reorder
router.get   ('/categories/:categoryId',                ctrl.getCategoryAttributes);
router.post  ('/categories/:categoryId',                ctrl.assignToCategory);
router.delete('/categories/:categoryId/:attributeId',   ctrl.removeFromCategory);
router.post  ('/categories/:categoryId/reorder',        ctrl.reorderForCategory);

// ── Product attribute values ───────────────────────────────────────────────────
router.get ('/products/:productId/values', ctrl.getProductValues);
router.put ('/products/:productId/values', ctrl.saveProductValues);

export default router;
