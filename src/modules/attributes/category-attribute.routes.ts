import { Router } from 'express';
import { AttributeController } from './attribute.controller';

/**
 * Mounted at /api/category-attributes
 *
 * POST   /                           → create (409 on duplicate)
 * GET    /:categoryId                → list for category (+ ancestors)
 * PUT    /:categoryId/:attributeId   → upsert (update flags)
 * DELETE /:categoryId/:attributeId   → remove
 */
const router = Router();
const ctrl   = new AttributeController();

router.post  ('/',                              ctrl.createCategoryAttribute);
router.get   ('/:categoryId',                  ctrl.listForCategory);
router.put   ('/:categoryId/:attributeId',     ctrl.assignToCategory);     // upsert route — reuse existing handler
router.delete('/:categoryId/:attributeId',     ctrl.deleteCategoryAttribute);

export default router;
