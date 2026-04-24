import prisma from '../../config/database';
import { generateUniqueCategorySlug } from '../../common/utils/slug.utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CategoryNode {
  id:              string;
  name:            string;
  slug:            string;
  description:     string | null;
  parentId:        string | null;
  level:           number;
  path:            string;
  order:           number;
  isActive:        boolean;
  imageUrl:        string | null;
  icon:            string | null;
  metaTitle:       string | null;
  metaDescription: string | null;
  tenantId:        string;
  createdAt:       Date;
  updatedAt:       Date;
  _count?:         { products: number };
  children:        CategoryNode[];
}

export interface FlatCategoryNode extends Omit<CategoryNode, 'children'> {
  depth:    number;
  label:    string;   // "— — Subcategory" style for selects
  hasChildren: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build nested tree from flat array */
function buildTree(
  flat: any[],
  parentId: string | null = null,
): CategoryNode[] {
  return flat
    .filter(c => c.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'tr'))
    .map(c => ({ ...c, children: buildTree(flat, c.id) }));
}

/** Flatten tree with depth-aware labels (for <select> components) */
function flattenTree(
  nodes: CategoryNode[],
  depth = 0,
  result: FlatCategoryNode[] = [],
): FlatCategoryNode[] {
  for (const node of nodes) {
    result.push({
      ...node,
      depth,
      label:       '— '.repeat(depth) + node.name,
      hasChildren: node.children.length > 0,
    });
    flattenTree(node.children, depth + 1, result);
  }
  return result;
}

/** Compute materialized path + level from parent */
async function computePathAndLevel(
  slug: string,
  parentId: string | null | undefined,
): Promise<{ path: string; level: number }> {
  if (!parentId) return { path: slug, level: 0 };  // null | undefined | "" → root

  const parent = await prisma.category.findUnique({ where: { id: parentId } });
  if (!parent) throw new Error('Parent category not found');

  return {
    path:  parent.path ? `${parent.path}/${slug}` : slug,
    level: parent.level + 1,
  };
}

/** Recursively update path/level for all descendants after a move */
async function cascadePathUpdate(
  categoryId: string,
  newPath:    string,
  newLevel:   number,
): Promise<void> {
  const children = await prisma.category.findMany({
    where: { parentId: categoryId },
  });

  for (const child of children) {
    const childPath  = `${newPath}/${child.slug}`;
    const childLevel = newLevel + 1;
    await prisma.category.update({
      where: { id: child.id },
      data:  { path: childPath, level: childLevel },
    });
    await cascadePathUpdate(child.id, childPath, childLevel);
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class CategoryService {

  // ── GET /categories/tree ────────────────────────────────────────────────────

  async getTree(tenantId: string): Promise<CategoryNode[]> {
    const flat = await prisma.category.findMany({
      where:   { tenantId },
      include: { _count: { select: { products: true } } },
      orderBy: [{ level: 'asc' }, { order: 'asc' }, { name: 'asc' }],
    });
    return buildTree(flat as any);
  }

  // ── GET /categories/flat ─────────────────────────────────────────────────────

  async getFlat(tenantId: string): Promise<FlatCategoryNode[]> {
    const tree = await this.getTree(tenantId);
    return flattenTree(tree);
  }

  // ── GET /categories (legacy, returns flat list for backward compat) ──────────

  async getAll(tenantId: string) {
    return prisma.category.findMany({
      where:   { tenantId },
      include: {
        parent:   true,
        children: { orderBy: [{ order: 'asc' }, { name: 'asc' }] },
        _count:   { select: { products: true } },
      },
      orderBy: [{ level: 'asc' }, { order: 'asc' }, { name: 'asc' }],
    });
  }

  // ── GET /categories/:id ──────────────────────────────────────────────────────

  async getById(id: string, tenantId: string) {
    return prisma.category.findFirst({
      where:   { id, tenantId },
      include: {
        parent:   true,
        children: { orderBy: [{ order: 'asc' }, { name: 'asc' }] },
        _count:   { select: { products: true } },
      },
    });
  }

  // ── GET /categories/:id/breadcrumb ───────────────────────────────────────────

  async getBreadcrumb(id: string, tenantId: string): Promise<any[]> {
    const crumbs: any[] = [];
    let current = await prisma.category.findFirst({ where: { id, tenantId } });

    while (current) {
      crumbs.unshift({ id: current.id, name: current.name, slug: current.slug, path: current.path });
      if (!current.parentId) break;
      current = await prisma.category.findFirst({ where: { id: current.parentId, tenantId } });
    }
    return crumbs;
  }

  // ── GET /categories/:id/descendants ─────────────────────────────────────────

  async getDescendants(id: string, tenantId: string) {
    const root = await prisma.category.findFirst({ where: { id, tenantId } });
    if (!root) return [];

    // All categories whose path starts with root.path/
    return prisma.category.findMany({
      where: {
        tenantId,
        path: { startsWith: root.path + '/' },
      },
      orderBy: [{ level: 'asc' }, { order: 'asc' }],
    });
  }

  // ── POST /categories ─────────────────────────────────────────────────────────

  async create(data: any, tenantId: string) {
    const slug     = data.slug || await generateUniqueCategorySlug(data.name, tenantId);
    const parentId = data.parentId || null;   // "" → null
    const { path, level } = await computePathAndLevel(slug, parentId);

    return prisma.category.create({
      data: {
        name:            data.name,
        slug,
        description:     data.description     ?? null,
        // Use relation syntax instead of scalar parentId (Prisma v5 self-ref relations)
        ...(parentId ? { parent: { connect: { id: parentId } } } : {}),
        level,
        path,
        order:           data.order            ?? 0,
        isActive:        data.isActive         ?? true,
        imageUrl:        data.imageUrl         ?? null,
        icon:            data.icon             ?? null,
        metaTitle:       data.metaTitle        ?? null,
        metaDescription: data.metaDescription  ?? null,
        tenant:          { connect: { id: tenantId } },
      },
      include: { parent: true, children: true, _count: { select: { products: true } } },
    });
  }

  // ── PUT /categories/:id ──────────────────────────────────────────────────────

  async update(id: string, data: any, tenantId: string) {
    const existing = await prisma.category.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Category not found');

    // Re-generate slug if name changed
    const slug = (data.name && data.name !== existing.name && !data.slug)
      ? await generateUniqueCategorySlug(data.name, tenantId, id)
      : (data.slug ?? existing.slug);

    // Normalize parentId: "" → null
    if (data.parentId !== undefined) data.parentId = data.parentId || null;

    // Re-compute path/level if parent changed or slug changed
    const parentChanged = data.parentId !== undefined && data.parentId !== existing.parentId;
    const slugChanged   = slug !== existing.slug;

    let path  = existing.path;
    let level = existing.level;

    const newParentId = data.parentId !== undefined ? (data.parentId || null) : existing.parentId;

    if (parentChanged || slugChanged) {
      ({ path, level } = await computePathAndLevel(slug, newParentId));
    }

    // Build parent relation update (Prisma v5 self-ref requires relation syntax)
    let parentRelation: any = {};
    if (data.parentId !== undefined) {
      if (newParentId) {
        parentRelation = { parent: { connect: { id: newParentId } } };
      } else {
        parentRelation = { parent: { disconnect: true } };
      }
    }

    const updated = await prisma.category.update({
      where: { id },
      data:  {
        name:            data.name            ?? existing.name,
        slug,
        description:     data.description     !== undefined ? data.description     : existing.description,
        ...parentRelation,
        level,
        path,
        order:           data.order           !== undefined ? data.order           : existing.order,
        isActive:        data.isActive        !== undefined ? data.isActive        : existing.isActive,
        imageUrl:        data.imageUrl        !== undefined ? data.imageUrl        : existing.imageUrl,
        icon:            data.icon            !== undefined ? data.icon            : existing.icon,
        metaTitle:       data.metaTitle       !== undefined ? data.metaTitle       : existing.metaTitle,
        metaDescription: data.metaDescription !== undefined ? data.metaDescription : existing.metaDescription,
      },
      include: { parent: true, children: true, _count: { select: { products: true } } },
    });

    // Cascade path/level update to all descendants
    if (parentChanged || slugChanged) {
      await cascadePathUpdate(id, path, level);
    }

    return updated;
  }

  // ── DELETE /categories/:id ───────────────────────────────────────────────────

  async delete(id: string, tenantId: string, force = false) {
    const category = await prisma.category.findFirst({
      where:   { id, tenantId },
      include: {
        _count: { select: { children: true, products: true } },
      },
    });
    if (!category) throw new Error('Category not found');

    if (!force) {
      if ((category as any)._count.children > 0) {
        throw new Error(
          `Bu kategorinin ${(category as any)._count.children} alt kategorisi var. Önce alt kategorileri silin veya taşıyın.`
        );
      }
      if ((category as any)._count.products > 0) {
        throw new Error(
          `Bu kategoride ${(category as any)._count.products} ürün var. Önce ürünleri farklı bir kategoriye taşıyın.`
        );
      }
    } else {
      // Force delete: move products to parent, then delete subtree
      await prisma.product.updateMany({
        where: { categoryId: id },
        data:  { categoryId: category.parentId ?? null },
      });
    }

    return prisma.category.delete({ where: { id } });
  }

  // ── Reorder ──────────────────────────────────────────────────────────────────

  async reorder(tenantId: string, items: Array<{ id: string; order: number }>) {
    await Promise.all(
      items.map(({ id, order }) =>
        prisma.category.updateMany({
          where: { id, tenantId },
          data:  { order },
        })
      )
    );
  }

  // ── GET /:id/products ────────────────────────────────────────────────────────

  async getProductsByCategory(categoryId: string, tenantId: string, includeDescendants = false) {
    if (!includeDescendants) {
      return prisma.product.findMany({
        where:   { categoryId, tenantId },
        include: { category: true, pricing: true, productImages: { take: 1, orderBy: { order: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });
    }

    // Include products from all descendant categories
    const category = await prisma.category.findFirst({ where: { id: categoryId, tenantId } });
    if (!category) return [];

    const descendants = await prisma.category.findMany({
      where:  { tenantId, path: { startsWith: category.path } },
      select: { id: true },
    });
    const categoryIds = descendants.map(d => d.id);

    return prisma.product.findMany({
      where:   { categoryId: { in: categoryIds }, tenantId },
      include: { category: true, pricing: true, productImages: { take: 1, orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
