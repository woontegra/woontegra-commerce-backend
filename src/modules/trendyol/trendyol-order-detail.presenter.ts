import prisma from '../../config/database';
import type { TrendyolOrder, TrendyolOrderItem } from '@prisma/client';

type OrderWithItems = TrendyolOrder & { items: TrendyolOrderItem[] };

export type EnrichedTrendyolOrderItem = TrendyolOrderItem & {
  imageUrl: string | null;
};

function pickFirstImage(images: string[] | null | undefined): string | null {
  if (!images?.length) return null;
  const url = images.find(i => typeof i === 'string' && i.trim());
  return url?.trim() ?? null;
}

function imageFromRawLine(rawPayload: unknown, barcode: string): string | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const lines = (rawPayload as Record<string, unknown>).lines;
  if (!Array.isArray(lines)) return null;

  const line = lines.find(
    (l) => l && typeof l === 'object' && String((l as Record<string, unknown>).barcode ?? '') === barcode,
  );
  if (!line || typeof line !== 'object') return null;

  const o = line as Record<string, unknown>;
  for (const key of ['productImage', 'productImageUrl', 'imageUrl', 'image', 'thumbnailUrl']) {
    const val = o[key];
    if (val != null && String(val).trim()) return String(val).trim();
  }
  return null;
}

function resolveItemImageUrl(
  item: TrendyolOrderItem,
  variant: { images: string[] } | undefined,
  product: { images: string[] } | undefined,
  rawPayload: unknown,
): string | null {
  return (
    pickFirstImage(variant?.images)
    ?? pickFirstImage(product?.images)
    ?? imageFromRawLine(rawPayload, item.barcode)
  );
}

/** Trendyol sipariş kalemlerine local ürün/varyant görseli ekler. */
export async function enrichTrendyolOrderDetail(order: OrderWithItems) {
  const productIds = [...new Set(order.items.map(i => i.productId).filter(Boolean))] as string[];
  const variantIds = [...new Set(order.items.map(i => i.variantId).filter(Boolean))] as string[];

  const variants = variantIds.length
    ? await prisma.productVariant.findMany({
        where:  { id: { in: variantIds } },
        select: { id: true, images: true, productId: true },
      })
    : [];

  const allProductIds = new Set<string>(productIds);
  for (const v of variants) allProductIds.add(v.productId);

  const products = allProductIds.size
    ? await prisma.product.findMany({
        where:  { id: { in: [...allProductIds] }, tenantId: order.tenantId },
        select: { id: true, images: true },
      })
    : [];

  const productMap = new Map(products.map(p => [p.id, p]));
  const variantMap = new Map(variants.map(v => [v.id, v]));

  const items: EnrichedTrendyolOrderItem[] = order.items.map(item => {
    const variant = item.variantId ? variantMap.get(item.variantId) : undefined;
    const productId = item.productId ?? variant?.productId;
    const product = productId ? productMap.get(productId) : undefined;

    return {
      ...item,
      imageUrl: resolveItemImageUrl(item, variant, product, order.rawPayload),
    };
  });

  return { ...order, items };
}
