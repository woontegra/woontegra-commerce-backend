import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { AttributeService } from './attribute.service';

const svc = new AttributeService();

const tid = (req: AuthRequest): string => req.user!.tenantId;

const ok  = (res: Response, data: any, status = 200) =>
  res.status(status).json({ status: 'success', data });
const fail = (res: Response, err: any) => {
  const msg  = err?.message || 'Server error';
  const code = err?.httpCode
             ?? (msg.includes('not found') || msg.includes('Not found') ? 404
               : msg.includes('Unique') || err?.code === 'DUPLICATE'    ? 409
               : 500);
  return res.status(code).json({ status: 'error', message: msg, code: err?.code });
};

export class AttributeController {

  // ── Attribute CRUD ───────────────────────────────────────────────────────────

  getAll = async (req: AuthRequest, res: Response) => {
    try { ok(res, await svc.getAll(tid(req))); }
    catch (e) { fail(res, e); }
  };

  getById = async (req: AuthRequest, res: Response) => {
    try {
      const attr = await svc.getById(req.params.id, tid(req));
      if (!attr) return res.status(404).json({ status: 'error', message: 'Not found' });
      ok(res, attr);
    } catch (e) { fail(res, e); }
  };

  create = async (req: AuthRequest, res: Response) => {
    try { ok(res, await svc.create(req.body, tid(req)), 201); }
    catch (e) { fail(res, e); }
  };

  update = async (req: AuthRequest, res: Response) => {
    try { ok(res, await svc.update(req.params.id, req.body, tid(req))); }
    catch (e) { fail(res, e); }
  };

  delete = async (req: AuthRequest, res: Response) => {
    try { await svc.delete(req.params.id, tid(req)); res.status(204).send(); }
    catch (e) { fail(res, e); }
  };

  // ── Value sub-resource ───────────────────────────────────────────────────────

  addValue = async (req: AuthRequest, res: Response) => {
    try { ok(res, await svc.addValue(req.params.id, tid(req), req.body), 201); }
    catch (e) { fail(res, e); }
  };

  deleteValue = async (req: AuthRequest, res: Response) => {
    try { await svc.deleteValue(req.params.valueId, tid(req)); res.status(204).send(); }
    catch (e) { fail(res, e); }
  };

  // ── Category linking ─────────────────────────────────────────────────────────

  /**
   * POST /api/category-attributes
   * Body: { categoryId, attributeId, required?, isVariant?, displayOrder? }
   * Returns 409 if already assigned.
   */
  createCategoryAttribute = async (req: AuthRequest, res: Response) => {
    try {
      const { categoryId, attributeId, required, isVariant, displayOrder } = req.body;
      if (!categoryId || !attributeId) {
        res.status(400).json({ status: 'error', message: 'categoryId and attributeId are required' });
        return;
      }
      ok(res, await svc.createCategoryAttribute(
        categoryId, attributeId, tid(req), { required, isVariant, displayOrder },
      ), 201);
    } catch (e) { fail(res, e); }
  };

  /**
   * GET /api/category-attributes/:categoryId
   * Alias for getCategoryAttributes — used by the new route.
   */
  listForCategory = async (req: AuthRequest, res: Response) => {
    try {
      const includeAncestors = req.query.ancestors !== 'false';
      ok(res, await svc.getForCategory(req.params.categoryId, tid(req), includeAncestors));
    } catch (e) { fail(res, e); }
  };

  /**
   * DELETE /api/category-attributes/:categoryId/:attributeId
   */
  deleteCategoryAttribute = async (req: AuthRequest, res: Response) => {
    try {
      await svc.removeFromCategory(req.params.categoryId, req.params.attributeId, tid(req));
      res.status(204).send();
    } catch (e) { fail(res, e); }
  };

  getCategoryAttributes = async (req: AuthRequest, res: Response) => {
    try {
      const includeAncestors = req.query.ancestors !== 'false';
      ok(res, await svc.getForCategory(req.params.categoryId, tid(req), includeAncestors));
    } catch (e) { fail(res, e); }
  };

  assignToCategory = async (req: AuthRequest, res: Response) => {
    try {
      // attributeId can come from body (POST) or URL param (PUT /:categoryId/:attributeId)
      const attributeId = req.params.attributeId ?? req.body.attributeId;
      ok(res, await svc.assignToCategory(
        req.params.categoryId,
        attributeId,
        tid(req),
        req.body,
      ), 201);
    } catch (e) { fail(res, e); }
  };

  removeFromCategory = async (req: AuthRequest, res: Response) => {
    try {
      await svc.removeFromCategory(req.params.categoryId, req.params.attributeId, tid(req));
      res.status(204).send();
    } catch (e) { fail(res, e); }
  };

  reorderForCategory = async (req: AuthRequest, res: Response) => {
    try {
      await svc.reorderForCategory(req.params.categoryId, tid(req), req.body.items);
      ok(res, { reordered: true });
    } catch (e) { fail(res, e); }
  };

  // ── Product values ───────────────────────────────────────────────────────────

  getProductValues = async (req: AuthRequest, res: Response) => {
    try { ok(res, await svc.getProductValues(req.params.productId)); }
    catch (e) { fail(res, e); }
  };

  saveProductValues = async (req: AuthRequest, res: Response) => {
    try {
      ok(res, await svc.saveProductValues(req.params.productId, tid(req), req.body.values ?? req.body));
    } catch (e) { fail(res, e); }
  };
}
