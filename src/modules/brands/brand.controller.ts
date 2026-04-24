import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import prisma from '../../config/database';

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export class BrandController {

  // GET /api/brands
  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const brands = await prisma.brand.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
      });

      // Enrich with product count from Product.brand string field
      const productCounts = await prisma.product.groupBy({
        by: ['brand'],
        where: { tenantId, brand: { not: null } },
        _count: { id: true },
      });
      const countMap = new Map(productCounts.map(r => [r.brand, r._count.id]));

      const enriched = brands.map(b => ({
        ...b,
        productCount: countMap.get(b.name) ?? 0,
      }));

      res.json({ status: 'success', data: enriched });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // GET /api/brands/stats — unique brands found in products (not in Brand table)
  getStats = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;

      const [total, productBrands] = await Promise.all([
        prisma.brand.count({ where: { tenantId } }),
        prisma.product.groupBy({
          by: ['brand'],
          where: { tenantId, brand: { not: null } },
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
        }),
      ]);

      res.json({ status: 'success', data: { total, productBrands } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // GET /api/brands/:id
  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const brand = await prisma.brand.findFirst({
        where: { id: req.params.id, tenantId: req.user!.tenantId },
      });
      if (!brand) { res.status(404).json({ error: 'Marka bulunamadı.' }); return; }
      res.json({ status: 'success', data: brand });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // POST /api/brands
  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const { name, description, logoUrl, website } = req.body;

      if (!name?.trim()) {
        res.status(400).json({ error: 'Marka adı zorunludur.' });
        return;
      }

      const slug = slugify(name.trim());

      const existing = await prisma.brand.findFirst({ where: { tenantId, slug } });
      if (existing) {
        res.status(409).json({ error: 'Bu isimde bir marka zaten var.' });
        return;
      }

      const brand = await prisma.brand.create({
        data: {
          name: name.trim(),
          slug,
          description: description?.trim() || null,
          logoUrl: logoUrl?.trim() || null,
          website: website?.trim() || null,
          tenantId,
        },
      });

      res.status(201).json({ status: 'success', data: brand });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // PUT /api/brands/:id
  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const { name, description, logoUrl, website, isActive } = req.body;

      const existing = await prisma.brand.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) { res.status(404).json({ error: 'Marka bulunamadı.' }); return; }

      const slug = name?.trim() ? slugify(name.trim()) : existing.slug;

      // Check slug uniqueness if name changed
      if (slug !== existing.slug) {
        const conflict = await prisma.brand.findFirst({ where: { tenantId, slug, id: { not: existing.id } } });
        if (conflict) { res.status(409).json({ error: 'Bu isimde bir marka zaten var.' }); return; }
      }

      const brand = await prisma.brand.update({
        where: { id: existing.id },
        data: {
          ...(name?.trim()        ? { name: name.trim(), slug } : {}),
          ...(description !== undefined ? { description: description?.trim() || null } : {}),
          ...(logoUrl !== undefined     ? { logoUrl: logoUrl?.trim() || null }         : {}),
          ...(website !== undefined     ? { website: website?.trim() || null }         : {}),
          ...(isActive !== undefined    ? { isActive }                                 : {}),
        },
      });

      // If name changed, sync to Product.brand string field
      if (name?.trim() && name.trim() !== existing.name) {
        await prisma.product.updateMany({
          where: { tenantId, brand: existing.name },
          data:  { brand: name.trim() },
        });
      }

      res.json({ status: 'success', data: brand });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // DELETE /api/brands/:id
  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const existing = await prisma.brand.findFirst({ where: { id: req.params.id, tenantId } });
      if (!existing) { res.status(404).json({ error: 'Marka bulunamadı.' }); return; }

      const clearProducts = req.query.clearProducts === 'true';
      if (clearProducts) {
        await prisma.product.updateMany({
          where: { tenantId, brand: existing.name },
          data:  { brand: null },
        });
      }

      await prisma.brand.delete({ where: { id: existing.id } });
      res.json({ status: 'success', message: 'Marka silindi.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // POST /api/brands/:id/assign — assign brand to products in given categories
  // Body: { categoryIds?: string[], assignToAll?: boolean }
  assign = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId  = req.user!.tenantId;
      const { categoryIds, assignToAll } = req.body;

      // Verify brand belongs to tenant
      const brand = await prisma.brand.findFirst({ where: { id: req.params.id, tenantId } });
      if (!brand) { res.status(404).json({ error: 'Marka bulunamadı.' }); return; }

      let result;
      if (assignToAll) {
        // Assign brand to ALL products of this tenant
        result = await prisma.product.updateMany({
          where: { tenantId },
          data:  { brand: brand.name },
        });
      } else if (Array.isArray(categoryIds) && categoryIds.length > 0) {
        // Assign brand to products in selected categories (including subcategories)
        // First collect all descendant category IDs
        const allCatIds = new Set<string>(categoryIds);
        // Iteratively fetch children
        let toExpand = [...categoryIds];
        while (toExpand.length > 0) {
          const children = await prisma.category.findMany({
            where:  { parentId: { in: toExpand }, tenantId },
            select: { id: true },
          });
          toExpand = children.map((c: any) => c.id).filter((id: string) => !allCatIds.has(id));
          toExpand.forEach((id: string) => allCatIds.add(id));
        }

        result = await prisma.product.updateMany({
          where: { tenantId, categoryId: { in: Array.from(allCatIds) } },
          data:  { brand: brand.name },
        });
      } else {
        res.status(400).json({ error: 'categoryIds veya assignToAll gerekli.' });
        return;
      }

      res.json({ status: 'success', updatedCount: result.count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // POST /api/brands/merge — rename a brand across all products
  merge = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const { from, to } = req.body;

      if (!from || !to) {
        res.status(400).json({ error: 'from ve to alanları zorunludur.' });
        return;
      }

      const result = await prisma.product.updateMany({
        where: { tenantId, brand: from },
        data:  { brand: to },
      });

      res.json({ status: 'success', updatedCount: result.count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
