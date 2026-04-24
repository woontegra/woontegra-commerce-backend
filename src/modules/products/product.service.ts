import prisma from '../../config/database';
import { generateUniqueProductSlug } from '../../common/utils/slug.utils';
import { searchService, toProductDocument } from '../search/search.service';

// ─── Variant display name helper ──────────────────────────────────────────────

/** Builds a human-readable label from relational VariantAttribute records.
 *  e.g. "Renk: Kırmızı / Beden: 40"
 *  Falls back to variant.name if no attributes are found. */
export function buildVariantDisplayName(variant: {
  name:              string | null;
  variantAttributes?: Array<{
    attribute?:      { name: string } | null;
    attributeValue?: { label: string } | null;
    textValue?:      string | null;
  }>;
}): string {
  const attrs = variant.variantAttributes ?? [];
  if (attrs.length === 0) return variant.name ?? '';

  const parts = attrs
    .filter(va => va.attribute)
    .map(va => {
      const attrName  = va.attribute!.name;
      const attrValue = va.attributeValue?.label ?? va.textValue ?? '';
      return attrValue ? `${attrName}: ${attrValue}` : attrName;
    });

  return parts.length > 0 ? parts.join(' / ') : (variant.name ?? '');
}

/** Adds `displayName` to every variant in a product (or list of products). */
function withDisplayNames<T extends { variants?: any[] }>(product: T): T {
  if (!product?.variants) return product;
  return {
    ...product,
    variants: product.variants.map(v => ({
      ...v,
      displayName: buildVariantDisplayName(v),
    })),
  };
}

// ─── Default include: full product domain ─────────────────────────────────────

const PRODUCT_INCLUDE = {
  category:      true,
  variants: {
    include: {
      variantAttributes: {
        include: {
          attribute:      true,
          attributeValue: true,
        },
        orderBy: { attribute: { displayOrder: 'asc' as const } },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  stock:         true,
  pricing:       true,
  shipping:      true,
  productImages: { orderBy: { order: 'asc' as const } },
} as const;

// Helper: fetch product with all relations (for search index)
async function fetchFull(id: string) {
  return prisma.product.findUnique({
    where:   { id },
    include: PRODUCT_INCLUDE,
  });
}

// ─── Desi calculation ─────────────────────────────────────────────────────────

export function calculateDesi(
  width?: number | null,
  height?: number | null,
  length?: number | null,
): number | null {
  if (!width || !height || !length) return null;
  return Number(((width * height * length) / 3000).toFixed(2));
}

// ─── Service ──────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Recommended Prisma / PostgreSQL indexes for product listing performance:
//
// In schema.prisma add to Product model:
//   @@index([tenantId, status])           — status filter
//   @@index([tenantId, categoryId])       — category filter
//   @@index([tenantId, createdAt(sort: Desc)]) — default sort
//   @@index([tenantId, price])            — price range filter + sort
//   @@index([name(ops: raw("gin_trgm_ops"))], type: Gin) — ILIKE search (needs pg_trgm)
//   @@index([sku])                        — sku search
//   @@index([barcode])                    — barcode search
//
// In ProductPrice model:
//   @@index([productId])                  — JOIN from product
//
// In Stock model:
//   @@index([productId])                  — JOIN from product
// ─────────────────────────────────────────────────────────────────────────────

// Allowed sort fields (whitelist to prevent SQL injection via orderBy)
const ALLOWED_SORT: Record<string, string> = {
  name:      'name',
  price:     'price',
  stock:     'createdAt', // stock sort is post-processed; fall back to date
  status:    'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ProductListItem {
  id:              string;
  name:            string;
  slug:            string;
  status:          string;
  isActive:        boolean;
  mainImage:       string | null;
  price:           number;
  stock:           number;
  variantCount:    number;
  category:        { id: string; name: string } | null;
  sku:             string | null;
  brand:           string | null;
  trendyolStatus:  string | null;  // null = never sent, 'SENT' | 'ERROR' | etc.
  trendyolSentAt:  Date   | null;
}

export interface ProductListResult {
  items:      ProductListItem[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

export class ProductService {

  // ── GET /api/products — optimized list ──────────────────────────────────
  async getAll(
    tenantId: string,
    filters?: {
      search?:     string;
      categoryId?: string;
      status?:     string;
      isActive?:   boolean;
      minPrice?:   number;
      maxPrice?:   number;
      page?:       number;
      limit?:      number;
      sortBy?:     string;
      sortDir?:    'asc' | 'desc';
    },
  ): Promise<ProductListResult> {
    // ── Pagination ────────────────────────────────────────────────────────
    const page  = Math.max(1, filters?.page  ?? 1);
    const limit = Math.min(100, filters?.limit ?? 20);
    const skip  = (page - 1) * limit;

    // ── WHERE clause ──────────────────────────────────────────────────────
    // tenantId is ALWAYS required — never list across tenants
    const where: any = { tenantId };

    if (filters?.search?.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { name:    { contains: q, mode: 'insensitive' } },
        { sku:     { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (filters?.categoryId) where.categoryId = filters.categoryId;

    if (filters?.status && filters.status !== 'all') {
      where.status = filters.status;
    }

    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    // Price filter: prefer ProductPrice.salePrice; fall back to Product.price
    if (filters?.minPrice !== undefined || filters?.maxPrice !== undefined) {
      where.price = {};
      if (filters.minPrice !== undefined) where.price.gte = filters.minPrice;
      if (filters.maxPrice !== undefined) where.price.lte = filters.maxPrice;
    }

    // ── Sort (whitelisted) ────────────────────────────────────────────────
    const rawSort   = filters?.sortBy ?? 'createdAt';
    const sortField = ALLOWED_SORT[rawSort] ?? 'createdAt';
    const sortDir   = filters?.sortDir === 'asc' ? 'asc' : 'desc';
    const orderBy   = { [sortField]: sortDir };

    // ── Parallel COUNT + DATA (single round-trip via $transaction) ────────
    // COUNT uses the same where but no joins → much faster than include
    // DATA selects only list-required fields (no shipping, no full variants)
    const [total, rows] = await prisma.$transaction([
      prisma.product.count({ where }),

      prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id:        true,
          name:      true,
          slug:      true,
          status:    true,
          isActive:  true,
          price:     true,  // legacy fallback if ProductPrice not set
          sku:       true,
          brand:     true,

          // Only the first image (already ordered by `order` in ProductImage)
          productImages: {
            select:  { url: true, isMain: true, order: true },
            orderBy: { order: 'asc' },
            take:    1,
          },

          // Only salePrice from ProductPrice relation
          pricing: {
            select: { salePrice: true },
          },

          // Only quantity from Stock
          stock: {
            select: { quantity: true },
          },

          // Category name for display
          category: {
            select: { id: true, name: true },
          },

          // Variant count: only IDs (minimal data)
          variants: {
            select:  { id: true },
            where:   { isActive: true }, // count only active variants
          },

          // Trendyol sync status (latest map entry for this product)
          trendyolMaps: {
            select:  { trendyolStatus: true, lastSyncAt: true },
            take:    1,
            orderBy: { lastSyncAt: 'desc' },
          },
        },
      }),
    ]);

    // ── Shape the response ────────────────────────────────────────────────
    const items: ProductListItem[] = rows.map(p => ({
      id:             p.id,
      name:           p.name,
      slug:           p.slug,
      status:         p.status,
      isActive:       p.isActive,
      sku:            p.sku,
      brand:          p.brand,
      mainImage:      p.productImages[0]?.url ?? null,
      // salePrice takes precedence over legacy Product.price
      price:          Number(p.pricing?.salePrice ?? p.price ?? 0),
      stock:          Number(p.stock?.quantity ?? 0),
      variantCount:   p.variants.length,
      category:       p.category ?? null,
      trendyolStatus: (p as any).trendyolMaps?.[0]?.trendyolStatus ?? null,
      trendyolSentAt: (p as any).trendyolMaps?.[0]?.lastSyncAt    ?? null,
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getById(id: string, tenantId: string) {
    const p = await prisma.product.findFirst({ where: { id, tenantId }, include: PRODUCT_INCLUDE });
    return p ? withDisplayNames(p) : null;
  }

  async getBySlug(slug: string, tenantId: string) {
    const p = await prisma.product.findFirst({ where: { slug, tenantId }, include: PRODUCT_INCLUDE });
    return p ? withDisplayNames(p) : null;
  }

  // ─── Create ─────────────────────────────────────────────────────────────────

  async create(data: any, tenantId: string) {
    // Extract categoryId so we can use Prisma relation syntax instead of raw scalar
    const { pricing, shipping, stock, images: _images, categoryId, ...productData } = data;

    const slug = productData.slug || await generateUniqueProductSlug(productData.name, tenantId);

    // Only inline-create pricing if meaningful data is present
    const hasPricing = pricing && (pricing.salePrice != null);

    // Only inline-create shipping if at least one value is non-null
    const hasShipping = shipping && Object.values(shipping).some(
      v => v != null && v !== false && v !== 0
    );

    const product = await prisma.product.create({
      data: {
        ...productData,
        slug,
        tenant:   { connect: { id: tenantId } },
        // Use relation syntax for categoryId (Prisma v5 rejects raw scalar FK when null)
        ...(categoryId != null
          ? { category: { connect: { id: categoryId } } }
          : {}
        ),
        ...(hasPricing && {
          pricing: {
            create: {
              salePrice:     Number(pricing.salePrice     ?? 0),
              purchasePrice: pricing.purchasePrice != null ? Number(pricing.purchasePrice) : null,
              discountPrice: pricing.discountPrice != null ? Number(pricing.discountPrice) : null,
              vatRate:       Number(pricing.vatRate ?? 18),
              currency:      pricing.currency ?? 'TRY',
            },
          },
        }),
        ...(hasShipping && {
          shipping: {
            create: this._buildShippingData(shipping),
          },
        }),
      },
      include: PRODUCT_INCLUDE,
    });

    searchService.upsertProduct(toProductDocument(product as any));
    return withDisplayNames(product);
  }

  // ─── Update ─────────────────────────────────────────────────────────────────

  async update(id: string, data: any, tenantId: string) {
    const { pricing, shipping, stock: _stock, images: _images, categoryId, ...productData } = data;

    if (productData.name && !productData.slug) {
      productData.slug = await generateUniqueProductSlug(productData.name, tenantId, id);
    }

    const product = await prisma.product.update({
      where: { id },
      data:  {
        ...productData,
        tenant: { connect: { id: tenantId } },
        // Prisma v5: use relation syntax for categoryId
        ...(categoryId !== undefined
          ? (categoryId != null
              ? { category: { connect: { id: categoryId } } }
              : { category: { disconnect: true } }
            )
          : {}
        ),
      },
      include: PRODUCT_INCLUDE,
    });

    // Upsert pricing separately
    if (pricing) {
      await prisma.productPrice.upsert({
        where:  { productId: id },
        create: {
          productId:     id,
          salePrice:     Number(pricing.salePrice     ?? 0),
          purchasePrice: pricing.purchasePrice != null ? Number(pricing.purchasePrice) : null,
          discountPrice: pricing.discountPrice != null ? Number(pricing.discountPrice) : null,
          vatRate:       Number(pricing.vatRate ?? 18),
          currency:      pricing.currency ?? 'TRY',
        },
        update: {
          salePrice:     Number(pricing.salePrice     ?? 0),
          purchasePrice: pricing.purchasePrice != null ? Number(pricing.purchasePrice) : null,
          discountPrice: pricing.discountPrice != null ? Number(pricing.discountPrice) : null,
          vatRate:       Number(pricing.vatRate ?? 18),
          currency:      pricing.currency ?? 'TRY',
        },
      });
    }

    // Upsert shipping separately
    if (shipping) {
      await prisma.productShipping.upsert({
        where:  { productId: id },
        create: { productId: id, ...this._buildShippingData(shipping) },
        update: this._buildShippingData(shipping),
      });
    }

    searchService.upsertProduct(toProductDocument(product as any));
    return withDisplayNames(product);
  }

  // ─── Upsert Pricing ─────────────────────────────────────────────────────────

  async upsertPricing(productId: string, tenantId: string, pricing: any) {
    const product = await prisma.product.findFirst({ where: { id: productId, tenantId } });
    if (!product) throw new Error('Product not found');

    return prisma.productPrice.upsert({
      where:  { productId },
      create: {
        productId,
        salePrice:     Number(pricing.salePrice     ?? 0),
        purchasePrice: pricing.purchasePrice != null ? Number(pricing.purchasePrice) : null,
        discountPrice: pricing.discountPrice != null ? Number(pricing.discountPrice) : null,
        vatRate:       Number(pricing.vatRate ?? 18),
        currency:      pricing.currency ?? 'TRY',
      },
      update: {
        salePrice:     Number(pricing.salePrice     ?? 0),
        purchasePrice: pricing.purchasePrice != null ? Number(pricing.purchasePrice) : null,
        discountPrice: pricing.discountPrice != null ? Number(pricing.discountPrice) : null,
        vatRate:       Number(pricing.vatRate ?? 18),
        currency:      pricing.currency ?? 'TRY',
      },
    });
  }

  // ─── Upsert Shipping ────────────────────────────────────────────────────────

  async upsertShipping(productId: string, tenantId: string, shipping: any) {
    const product = await prisma.product.findFirst({ where: { id: productId, tenantId } });
    if (!product) throw new Error('Product not found');

    const d = this._buildShippingData(shipping);
    return prisma.productShipping.upsert({
      where:  { productId },
      create: { productId, ...d },
      update: d,
    });
  }

  // ─── Manage ProductImages ────────────────────────────────────────────────────

  async saveImages(productId: string, tenantId: string, images: Array<{ url: string; order: number; isMain?: boolean; alt?: string }>) {
    const product = await prisma.product.findFirst({ where: { id: productId, tenantId } });
    if (!product) throw new Error('Product not found');

    // Replace all images
    await prisma.productImage.deleteMany({ where: { productId } });

    if (images.length > 0) {
      await prisma.productImage.createMany({
        data: images.map((img, idx) => ({
          productId,
          url:    img.url,
          order:  img.order ?? idx,
          isMain: img.isMain ?? (idx === 0),
          alt:    img.alt ?? null,
        })),
      });
    }

    return prisma.productImage.findMany({
      where:   { productId },
      orderBy: { order: 'asc' },
    });
  }

  // ─── Upsert Stock ────────────────────────────────────────────────────────────

  async upsertStock(productId: string, tenantId: string, stock: { quantity: number; unit?: string; minStock?: number | null }) {
    return prisma.stock.upsert({
      where:  { productId },
      create: {
        productId,
        tenantId,
        quantity:         Number(stock.quantity ?? 0),
        reservedQuantity: 0,
        unit:             stock.unit ?? 'adet',
        minStock:         stock.minStock != null ? Number(stock.minStock) : null,
      },
      update: {
        quantity: Number(stock.quantity ?? 0),
        unit:     stock.unit ?? 'adet',
        minStock: stock.minStock != null ? Number(stock.minStock) : null,
      },
    });
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────

  async delete(id: string, tenantId: string) {
    const result = await prisma.product.delete({ where: { id } });
    searchService.deleteProduct(id);
    return result;
  }

  // ─── Bulk re-index (admin / script) ─────────────────────────────────────────

  async reindexTenant(tenantId: string): Promise<number> {
    const products = await prisma.product.findMany({
      where:   { tenantId },
      include: { category: true, variants: true },
    });
    await searchService.upsertProducts(products.map(toProductDocument));
    return products.length;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private _buildShippingData(s: any) {
    const w = s.width  != null ? Number(s.width)  : null;
    const h = s.height != null ? Number(s.height) : null;
    const l = s.length != null ? Number(s.length) : null;

    const desi = s.desi != null
      ? Number(s.desi)
      : calculateDesi(w, h, l);

    return {
      weight:           s.weight           != null ? Number(s.weight)           : null,
      width:            w,
      height:           h,
      length:           l,
      desi,
      freeShipping:     Boolean(s.freeShipping ?? false),
      shippingCost:     s.shippingCost     != null ? Number(s.shippingCost)     : null,
      cargoCompanyId:   s.cargoCompanyId   != null ? Number(s.cargoCompanyId)   : null,
      deliveryDuration: s.deliveryDuration != null ? Number(s.deliveryDuration) : null,
    };
  }
}
