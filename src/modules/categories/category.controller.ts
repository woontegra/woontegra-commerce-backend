import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { CategoryService } from './category.service';
import prisma from '../../config/database';

const svc = new CategoryService();

export class CategoryController {

  // ── GET /categories/tree ───────────────────────────────────────────────────

  getTree = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tree = await svc.getTree(req.user!.tenantId);
      res.json({ status: 'success', data: tree });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to build category tree' });
    }
  };

  // ── GET /categories/flat ───────────────────────────────────────────────────

  getFlat = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const flat = await svc.getFlat(req.user!.tenantId);
      res.json({ status: 'success', data: flat });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to build flat categories' });
    }
  };

  // ── GET /categories  (legacy – full list with parent/children) ─────────────

  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const categories = await svc.getAll(req.user!.tenantId);
      res.json({ status: 'success', data: categories });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to fetch categories' });
    }
  };

  // ── GET /categories/:id ────────────────────────────────────────────────────

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const category = await svc.getById(req.params.id, req.user!.tenantId);
      if (!category) { res.status(404).json({ error: 'Category not found' }); return; }
      res.json({ status: 'success', data: category });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to fetch category' });
    }
  };

  // ── GET /categories/:id/breadcrumb ─────────────────────────────────────────

  getBreadcrumb = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const crumbs = await svc.getBreadcrumb(req.params.id, req.user!.tenantId);
      res.json({ status: 'success', data: crumbs });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to get breadcrumb' });
    }
  };

  // ── GET /categories/:id/descendants ───────────────────────────────────────

  getDescendants = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const descendants = await svc.getDescendants(req.params.id, req.user!.tenantId);
      res.json({ status: 'success', data: descendants });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to get descendants' });
    }
  };

  // ── POST /categories ───────────────────────────────────────────────────────

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const category = await svc.create(req.body, req.user!.tenantId);
      res.status(201).json({ status: 'success', data: category });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to create category' });
    }
  };

  // ── PUT /categories/:id ────────────────────────────────────────────────────

  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const category = await svc.update(req.params.id, req.body, req.user!.tenantId);
      res.json({ status: 'success', data: category });
    } catch (err: any) {
      res.status(err?.message?.includes('not found') ? 404 : 500)
        .json({ error: err?.message ?? 'Failed to update category' });
    }
  };

  // ── DELETE /categories/:id ─────────────────────────────────────────────────
  // Query param: ?force=true  → force delete (moves products to parent)

  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const force = req.query.force === 'true';
      await svc.delete(req.params.id, req.user!.tenantId, force);
      res.status(204).send();
    } catch (err: any) {
      const status = err?.message?.includes('not found') ? 404
        : (err?.message?.includes('alt kategori') || err?.message?.includes('ürün var')) ? 409
        : 500;
      res.status(status).json({ error: err?.message ?? 'Failed to delete category' });
    }
  };

  // ── DELETE /categories/bulk ───────────────────────────────────────────────
  // Body: { ids: string[], force?: boolean }
  // Optimized: batch queries instead of N serial round-trips

  bulkDelete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { ids, force = false } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'ids dizisi zorunludur.' });
        return;
      }

      const tenantId = req.user!.tenantId;

      // 1. Fetch all requested categories with child/product counts in ONE query
      const found = await prisma.category.findMany({
        where:   { id: { in: ids }, tenantId },
        include: { _count: { select: { children: true, products: true } } },
      });

      const foundIds = new Set(found.map(c => c.id));
      const errors: { id: string; name: string; reason: string }[] = ids
        .filter(id => !foundIds.has(id))
        .map(id => ({ id, name: '', reason: 'Bulunamadı veya erişim yok.' }));

      let toDeleteIds: string[];

      if (!force) {
        // Without force: only leaf categories with no products
        const skipped = found.filter(c => (c as any)._count.children > 0 || (c as any)._count.products > 0);
        skipped.forEach(c => errors.push({
          id:     c.id,
          name:   c.name,
          reason: (c as any)._count.children > 0
            ? `${(c as any)._count.children} alt kategori var`
            : `${(c as any)._count.products} ürün var`,
        }));
        toDeleteIds = found
          .filter(c => (c as any)._count.children === 0 && (c as any)._count.products === 0)
          .map(c => c.id);
      } else {
        // Force: move products to parent in parallel, then delete all
        await Promise.all(
          found.map(c =>
            prisma.product.updateMany({
              where: { categoryId: c.id, tenantId },
              data:  { categoryId: (c as any).parentId ?? null },
            })
          )
        );
        toDeleteIds = found.map(c => c.id);
      }

      // 2. Single deleteMany — much faster than N individual deletes
      const result = await prisma.category.deleteMany({
        where: { id: { in: toDeleteIds }, tenantId },
      });

      res.json({ status: 'success', deleted: result.count, errors });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Toplu silme başarısız.' });
    }
  };

  // ── POST /categories/reorder ───────────────────────────────────────────────

  reorder = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { items } = req.body; // [{ id, order }]
      if (!Array.isArray(items)) { res.status(400).json({ error: 'items must be an array' }); return; }
      await svc.reorder(req.user!.tenantId, items);
      res.json({ status: 'success' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to reorder' });
    }
  };

  // ── GET /categories/:id/products ──────────────────────────────────────────

  getProducts = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const includeDescendants = req.query.descendants === 'true';
      const products = await svc.getProductsByCategory(
        req.params.id, req.user!.tenantId, includeDescendants,
      );
      res.json({ status: 'success', data: products });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Failed to fetch products' });
    }
  };
}
