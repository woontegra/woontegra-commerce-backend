import prisma from '../../config/database';

// ─── helpers ──────────────────────────────────────────────────────────────────

function toSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Generate a slug unique within the tenant — appends -2, -3 … if needed */
async function uniqueSlug(base: string, tenantId: string, excludeId?: string): Promise<string> {
  let candidate = base;
  let suffix    = 1;
  while (true) {
    const existing = await prisma.attribute.findFirst({
      where: {
        slug:     candidate,
        tenantId,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return candidate;
    suffix++;
    candidate = `${base}-${suffix}`;
  }
}

// ─── Attribute CRUD ───────────────────────────────────────────────────────────

export class AttributeService {

  // ── list ─────────────────────────────────────────────────────────────────────

  async getAll(tenantId: string) {
    return prisma.attribute.findMany({
      where:   { tenantId },
      include: { values: { orderBy: { displayOrder: 'asc' } } },
      orderBy: { displayOrder: 'asc' },
    });
  }

  // ── single ───────────────────────────────────────────────────────────────────

  async getById(id: string, tenantId: string) {
    return prisma.attribute.findFirst({
      where:   { id, tenantId },
      include: { values: { orderBy: { displayOrder: 'asc' } } },
    });
  }

  // ── create ───────────────────────────────────────────────────────────────────

  async create(data: any, tenantId: string) {
    const baseSlug = data.slug || toSlug(data.name);
    const slug     = await uniqueSlug(baseSlug, tenantId);
    const values   = data.values as Array<{ value?: string; label: string; color?: string; displayOrder?: number }> | undefined;

    return prisma.attribute.create({
      data: {
        name:         data.name,
        slug,
        type:         data.type         ?? 'select',
        unit:         data.unit         ?? null,
        isFilterable: data.isFilterable ?? true,
        isRequired:   data.isRequired   ?? false,
        displayOrder: data.displayOrder ?? 0,
        tenant: { connect: { id: tenantId } },
        values: values?.length
          ? {
              create: values.map((v, i) => ({
                value:        v.value || toSlug(v.label),
                label:        v.label,
                color:        v.color  ?? null,
                displayOrder: v.displayOrder ?? i,
              })),
            }
          : undefined,
      },
      include: { values: { orderBy: { displayOrder: 'asc' } } },
    });
  }

  // ── update ───────────────────────────────────────────────────────────────────

  async update(id: string, data: any, tenantId: string) {
    const existing = await prisma.attribute.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Attribute not found');

    const baseSlug = data.slug || (data.name ? toSlug(data.name) : existing.slug);
    const slug     = await uniqueSlug(baseSlug, tenantId, id);

    // Replace all values if provided
    if (data.values !== undefined) {
      await prisma.attributeValue.deleteMany({ where: { attributeId: id } });

      if ((data.values as any[]).length > 0) {
        await prisma.attributeValue.createMany({
          data: (data.values as any[]).map((v: any, i: number) => ({
            attributeId:  id,
            value:        v.value || toSlug(v.label),
            label:        v.label,
            color:        v.color  ?? null,
            displayOrder: v.displayOrder ?? i,
          })),
        });
      }
    }

    return prisma.attribute.update({
      where: { id },
      data: {
        name:         data.name         ?? existing.name,
        slug,
        type:         data.type         ?? existing.type,
        unit:         data.unit         !== undefined ? data.unit         : existing.unit,
        isFilterable: data.isFilterable !== undefined ? data.isFilterable : existing.isFilterable,
        isRequired:   data.isRequired   !== undefined ? data.isRequired   : existing.isRequired,
        displayOrder: data.displayOrder !== undefined ? data.displayOrder : existing.displayOrder,
      },
      include: { values: { orderBy: { displayOrder: 'asc' } } },
    });
  }

  // ── delete ───────────────────────────────────────────────────────────────────

  async delete(id: string, tenantId: string) {
    const existing = await prisma.attribute.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Attribute not found');

    return prisma.attribute.delete({ where: { id } });
  }

  // ── value helpers ────────────────────────────────────────────────────────────

  async addValue(attributeId: string, tenantId: string, data: any) {
    const attr = await prisma.attribute.findFirst({ where: { id: attributeId, tenantId } });
    if (!attr) throw new Error('Attribute not found');

    return prisma.attributeValue.create({
      data: {
        attributeId,
        value:        data.value || toSlug(data.label),
        label:        data.label,
        color:        data.color        ?? null,
        displayOrder: data.displayOrder ?? 0,
      },
    });
  }

  async deleteValue(valueId: string, tenantId: string) {
    const val = await prisma.attributeValue.findFirst({
      where: { id: valueId, attribute: { tenantId } },
    });
    if (!val) throw new Error('Value not found');
    return prisma.attributeValue.delete({ where: { id: valueId } });
  }

  // ─── Category-Attribute linking ───────────────────────────────────────────────

  /**
   * Get all attributes assigned to a category.
   * Optionally crawls up the parent chain and merges ancestor attributes.
   */
  async getForCategory(categoryId: string, tenantId: string, includeAncestors = true) {
    // Collect category IDs: self + all ancestors (via path)
    const cat = await prisma.category.findFirst({ where: { id: categoryId, tenantId } });
    if (!cat) return [];

    let categoryIds = [categoryId];

    if (includeAncestors && cat.path) {
      // path = "elektronik/telefonlar/akilli-telefonlar"
      // Find all ancestor categories by slug path segments
      const slugs = cat.path.split('/').slice(0, -1); // exclude self slug
      if (slugs.length > 0) {
        const ancestors = await prisma.category.findMany({
          where: { tenantId, slug: { in: slugs } },
          select: { id: true },
        });
        categoryIds = [...categoryIds, ...ancestors.map(a => a.id)];
      }
    }

    const rows = await prisma.categoryAttribute.findMany({
      where: {
        categoryId: { in: categoryIds },
        attribute:  { tenantId },          // cross-tenant leak guard
      },
      include: {
        attribute: {
          include: { values: { orderBy: { displayOrder: 'asc' } } },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });

    // Deduplicate by attributeId (self overrides ancestor)
    const map = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      if (!map.has(row.attributeId) || row.categoryId === categoryId) {
        map.set(row.attributeId, row);
      }
    }

    return Array.from(map.values()).sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async assignToCategory(categoryId: string, attributeId: string, tenantId: string, opts: any = {}) {
    const [cat, attr] = await Promise.all([
      prisma.category.findFirst({ where: { id: categoryId, tenantId } }),
      prisma.attribute.findFirst({ where: { id: attributeId, tenantId } }),
    ]);
    if (!cat)  throw new Error('Category not found');
    if (!attr) throw new Error('Attribute not found');

    return prisma.categoryAttribute.upsert({
      where:  { categoryId_attributeId: { categoryId, attributeId } },
      create: {
        categoryId,
        attributeId,
        required:     opts.required     ?? false,
        isVariant:    opts.isVariant    ?? false,
        displayOrder: opts.displayOrder ?? 0,
      },
      update: {
        required:     opts.required     ?? false,
        isVariant:    opts.isVariant    ?? false,
        displayOrder: opts.displayOrder ?? 0,
      },
    });
  }

  /**
   * Create-only: returns 409 if already assigned.
   * Used by POST /api/category-attributes.
   */
  async createCategoryAttribute(
    categoryId:  string,
    attributeId: string,
    tenantId:    string,
    opts: { required?: boolean; isVariant?: boolean; displayOrder?: number } = {},
  ) {
    const [cat, attr] = await Promise.all([
      prisma.category.findFirst({ where: { id: categoryId,  tenantId }, select: { id: true } }),
      prisma.attribute.findFirst({ where: { id: attributeId, tenantId }, select: { id: true } }),
    ]);
    if (!cat)  throw Object.assign(new Error('Category not found'),  { httpCode: 404 });
    if (!attr) throw Object.assign(new Error('Attribute not found'), { httpCode: 404 });

    const existing = await prisma.categoryAttribute.findUnique({
      where: { categoryId_attributeId: { categoryId, attributeId } },
      select: { id: true },
    });
    if (existing) {
      throw Object.assign(
        new Error('Bu özellik bu kategoriye zaten atanmış'),
        { httpCode: 409, code: 'DUPLICATE' },
      );
    }

    return prisma.categoryAttribute.create({
      data: {
        categoryId,
        attributeId,
        required:     opts.required     ?? false,
        isVariant:    opts.isVariant    ?? false,
        displayOrder: opts.displayOrder ?? 0,
      },
      include: {
        attribute: {
          include: { values: { orderBy: { displayOrder: 'asc' } } },
        },
      },
    });
  }

  async removeFromCategory(categoryId: string, attributeId: string, tenantId: string) {
    const cat = await prisma.category.findFirst({ where: { id: categoryId, tenantId } });
    if (!cat) throw new Error('Category not found');
    return prisma.categoryAttribute.deleteMany({ where: { categoryId, attributeId } });
  }

  async reorderForCategory(categoryId: string, tenantId: string, items: Array<{ attributeId: string; displayOrder: number }>) {
    await Promise.all(
      items.map(({ attributeId, displayOrder }) =>
        prisma.categoryAttribute.updateMany({
          where: { categoryId, attributeId },
          data:  { displayOrder },
        })
      )
    );
  }

  // ─── Product attribute values ─────────────────────────────────────────────────

  async getProductValues(productId: string) {
    return prisma.productAttributeValue.findMany({
      where:   { productId },
      include: { attribute: true, attributeValue: true },
    });
  }

  /**
   * Upsert product attribute values.
   * payload: Array<{ attributeId, value?, attributeValueId? }>
   */
  async saveProductValues(productId: string, tenantId: string, payload: any[]) {
    // Verify product belongs to tenant
    const product = await prisma.product.findFirst({ where: { id: productId, tenantId } });
    if (!product) throw new Error('Product not found');

    // Delete existing & recreate
    await prisma.productAttributeValue.deleteMany({ where: { productId } });

    if (payload.length === 0) return [];

    await prisma.productAttributeValue.createMany({
      data: payload.map((p: any) => ({
        productId,
        attributeId:      p.attributeId,
        value:            p.value            ?? null,
        attributeValueId: p.attributeValueId ?? null,
      })),
    });

    return prisma.productAttributeValue.findMany({
      where:   { productId },
      include: { attribute: true, attributeValue: true },
    });
  }
}
