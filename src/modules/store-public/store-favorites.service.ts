import prisma from '../../config/database';

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v && typeof (v as { toNumber: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const PRODUCT_INCLUDE = {
  productImages: { orderBy: { order: 'asc' as const }, take: 1, select: { url: true } },
  pricing:         { select: { salePrice: true, discountPrice: true } },
  stock:           { select: { quantity: true } },
} as const;

function mapFavoriteProduct(
  product: {
    id: string;
    name: string;
    slug: string;
    price: unknown;
    isActive: boolean;
    status: string;
    tenantId: string;
    productImages: { url: string }[];
    pricing: { salePrice: unknown; discountPrice: unknown | null } | null;
    stock: { quantity: unknown } | null;
  },
) {
  const price = num(product.pricing?.salePrice ?? product.price);
  const discountPrice =
    product.pricing?.discountPrice != null ? num(product.pricing.discountPrice) : null;

  return {
    id:            product.id,
    name:          product.name,
    slug:          product.slug,
    price,
    discountPrice,
    image:         product.productImages[0]?.url ?? null,
    stock:         Number(product.stock?.quantity ?? 0),
    isActive:      product.isActive,
    status:        product.status,
  };
}

async function assertProductFavoritable(tenantId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    select: { id: true, isActive: true, status: true },
  });

  if (!product) {
    throw new Error('Ürün bulunamadı.');
  }
  if (!product.isActive || product.status !== 'active') {
    throw new Error('Bu ürün favorilere eklenemez.');
  }
  return product;
}

export class StoreFavoritesService {
  async list(tenantId: string, customerId: string) {
    const rows = await prisma.customerFavorite.findMany({
      where:   { tenantId, customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        product: { include: PRODUCT_INCLUDE },
      },
    });

    return rows
      .filter(r => r.product.isActive && r.product.status === 'active')
      .map(r => ({
        id:        r.id,
        productId: r.productId,
        createdAt: r.createdAt,
        product:   mapFavoriteProduct(r.product),
      }));
  }

  async listProductIds(tenantId: string, customerId: string): Promise<string[]> {
    const rows = await prisma.customerFavorite.findMany({
      where:   { tenantId, customerId },
      select:  { productId: true },
    });
    return rows.map(r => r.productId);
  }

  async add(tenantId: string, customerId: string, productId: string) {
    await assertProductFavoritable(tenantId, productId);

    const existing = await prisma.customerFavorite.findUnique({
      where: { customerId_productId: { customerId, productId } },
      include: { product: { include: PRODUCT_INCLUDE } },
    });

    if (existing) {
      if (existing.tenantId !== tenantId) {
        throw new Error('Ürün bulunamadı.');
      }
      return {
        id:        existing.id,
        productId: existing.productId,
        createdAt: existing.createdAt,
        product:   mapFavoriteProduct(existing.product),
        alreadyExists: true,
      };
    }

    const row = await prisma.customerFavorite.create({
      data: { tenantId, customerId, productId },
      include: { product: { include: PRODUCT_INCLUDE } },
    });

    return {
      id:        row.id,
      productId: row.productId,
      createdAt: row.createdAt,
      product:   mapFavoriteProduct(row.product),
      alreadyExists: false,
    };
  }

  async remove(tenantId: string, customerId: string, productId: string) {
    const existing = await prisma.customerFavorite.findFirst({
      where: { tenantId, customerId, productId },
    });
    if (!existing) {
      throw new Error('Favori bulunamadı.');
    }
    await prisma.customerFavorite.delete({ where: { id: existing.id } });
  }
}

export const storeFavoritesService = new StoreFavoritesService();
