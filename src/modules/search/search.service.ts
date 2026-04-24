import { meiliClient } from '../../config/meilisearch';
import { logger } from '../../config/logger';

// ─── Document shape stored in Meilisearch ────────────────────────────────────

export interface ProductDocument {
  id:           string;  // Meilisearch primary key
  tenantId:     string;  // Used to isolate per-tenant results
  name:         string;
  slug:         string;
  description:  string;
  price:        number;
  basePrice:    number | null;
  sku:          string | null;
  isActive:     boolean;
  images:       string[];
  categoryId:   string | null;
  categoryName: string | null;
  categorySlug: string | null;
  hasVariants:  boolean;
  unitType:     string;
  stockTotal:   number;  // sum of variant stock or product-level stock
  createdAt:    number;  // unix timestamp for sorting
  updatedAt:    number;
}

// ─── Index name ───────────────────────────────────────────────────────────────

const INDEX = 'products';

// ─── SearchService ────────────────────────────────────────────────────────────

export class SearchService {
  private get index() {
    return meiliClient.index(INDEX);
  }

  // ── Setup (call once at startup) ───────────────────────────────────────────

  async setupIndex(): Promise<void> {
    try {
      // Create index if missing
      await meiliClient.createIndex(INDEX, { primaryKey: 'id' });

      const idx = this.index;

      // Searchable: fields ranked by relevance
      await idx.updateSearchableAttributes([
        'name',
        'description',
        'sku',
        'categoryName',
      ]);

      // Filterable: used in WHERE-style filtering
      await idx.updateFilterableAttributes([
        'tenantId',
        'categoryId',
        'categoryName',
        'isActive',
        'hasVariants',
        'unitType',
        'price',
        'stockTotal',
      ]);

      // Sortable: used in ORDER BY-style sorting
      await idx.updateSortableAttributes([
        'price',
        'createdAt',
        'updatedAt',
        'name',
        'stockTotal',
      ]);

      // Ranking rules — relevance first, then newest
      await idx.updateRankingRules([
        'words',
        'typo',
        'proximity',
        'attribute',
        'sort',
        'exactness',
        'createdAt:desc',
      ]);

      // Typo tolerance: allow typos in short words
      await idx.updateTypoTolerance({
        enabled:          true,
        minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
      });

      logger.info({ message: '[Meilisearch] Index configured', index: INDEX });
    } catch (err: any) {
      // 'index_already_exists' is fine; other errors just warn
      if (!err?.message?.includes('already exists')) {
        logger.warn({ message: '[Meilisearch] setupIndex warning', error: err?.message });
      }
    }
  }

  // ── Upsert a single product ────────────────────────────────────────────────

  async upsertProduct(doc: ProductDocument): Promise<void> {
    try {
      await this.index.addDocuments([doc]);
    } catch (err: any) {
      logger.warn({ message: '[Meilisearch] upsertProduct failed', error: err?.message, id: doc.id });
    }
  }

  // ── Upsert many products (bulk) ────────────────────────────────────────────

  async upsertProducts(docs: ProductDocument[]): Promise<void> {
    if (!docs.length) return;
    try {
      // Meilisearch recommends batches ≤ 1000
      const BATCH = 500;
      for (let i = 0; i < docs.length; i += BATCH) {
        await this.index.addDocuments(docs.slice(i, i + BATCH));
      }
      logger.info({ message: '[Meilisearch] Bulk upsert done', count: docs.length });
    } catch (err: any) {
      logger.warn({ message: '[Meilisearch] upsertProducts failed', error: err?.message });
    }
  }

  // ── Delete a product ──────────────────────────────────────────────────────

  async deleteProduct(id: string): Promise<void> {
    try {
      await this.index.deleteDocument(id);
    } catch (err: any) {
      logger.warn({ message: '[Meilisearch] deleteProduct failed', error: err?.message, id });
    }
  }

  // ── Delete all products for a tenant ──────────────────────────────────────

  async deleteTenantProducts(tenantId: string): Promise<void> {
    try {
      await this.index.deleteDocuments({ filter: `tenantId = "${tenantId}"` });
    } catch (err: any) {
      logger.warn({ message: '[Meilisearch] deleteTenantProducts failed', error: err?.message });
    }
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async search(params: {
    tenantId:    string;
    q?:          string;
    // Filters
    categoryId?: string;
    minPrice?:   number;
    maxPrice?:   number;
    isActive?:   boolean;
    hasVariants?: boolean;
    unitType?:   string;
    inStock?:    boolean;
    // Pagination & sort
    page?:       number;
    limit?:      number;
    sort?:       'price_asc' | 'price_desc' | 'newest' | 'oldest' | 'name_asc';
  }) {
    const {
      tenantId, q = '',
      categoryId, minPrice, maxPrice, isActive, hasVariants, unitType, inStock,
      page = 1, limit = 20,
      sort = 'newest',
    } = params;

    // ── Build filter array ─────────────────────────────────────────────────
    const filters: string[] = [`tenantId = "${tenantId}"`];

    if (categoryId)              filters.push(`categoryId = "${categoryId}"`);
    if (typeof isActive === 'boolean') filters.push(`isActive = ${isActive}`);
    if (typeof hasVariants === 'boolean') filters.push(`hasVariants = ${hasVariants}`);
    if (unitType)                filters.push(`unitType = "${unitType}"`);
    if (inStock)                 filters.push(`stockTotal > 0`);
    if (minPrice != null)        filters.push(`price >= ${minPrice}`);
    if (maxPrice != null)        filters.push(`price <= ${maxPrice}`);

    // ── Sort ───────────────────────────────────────────────────────────────
    const sortMap: Record<string, string[]> = {
      price_asc:  ['price:asc'],
      price_desc: ['price:desc'],
      newest:     ['createdAt:desc'],
      oldest:     ['createdAt:asc'],
      name_asc:   ['name:asc'],
    };

    try {
      const result = await this.index.search(q, {
        filter:              filters.join(' AND '),
        sort:                sortMap[sort] ?? ['createdAt:desc'],
        offset:              (page - 1) * limit,
        limit,
        attributesToHighlight: ['name', 'description'],
        highlightPreTag:     '<mark>',
        highlightPostTag:    '</mark>',
        facets:              ['categoryName', 'unitType', 'isActive'],
      });

      return {
        hits:         result.hits,
        total:        result.estimatedTotalHits ?? 0,
        page,
        limit,
        totalPages:   Math.ceil((result.estimatedTotalHits ?? 0) / limit),
        facets:       result.facetDistribution ?? {},
        processingMs: result.processingTimeMs,
      };
    } catch (err: any) {
      logger.warn({ message: '[Meilisearch] search failed', error: err?.message });
      // Return empty result — never crash the caller
      return { hits: [], total: 0, page, limit, totalPages: 0, facets: {}, processingMs: 0 };
    }
  }

  // ── Get facets (categories, unitTypes) for filter panel ──────────────────

  async getFacets(tenantId: string) {
    try {
      const result = await this.index.search('', {
        filter: `tenantId = "${tenantId}" AND isActive = true`,
        limit:  0,
        facets: ['categoryName', 'unitType'],
      });
      return result.facetDistribution ?? {};
    } catch {
      return {};
    }
  }
}

export const searchService = new SearchService();

// ─── Helper: Prisma product → ProductDocument ─────────────────────────────────

export function toProductDocument(product: any): ProductDocument {
  const stock = product.variants?.reduce((s: number, v: any) => s + (v.stock ?? 0), 0)
    ?? (product.stock ?? 0);

  return {
    id:           product.id,
    tenantId:     product.tenantId,
    name:         product.name ?? '',
    slug:         product.slug ?? '',
    description:  product.description ?? '',
    price:        Number(product.price ?? 0),
    basePrice:    product.basePrice != null ? Number(product.basePrice) : null,
    sku:          product.sku ?? null,
    isActive:     product.isActive ?? true,
    images:       product.images ?? [],
    categoryId:   product.categoryId ?? null,
    categoryName: product.category?.name ?? null,
    categorySlug: product.category?.slug ?? null,
    hasVariants:  product.hasVariants ?? false,
    unitType:     product.unitType ?? 'piece',
    stockTotal:   stock,
    createdAt:    new Date(product.createdAt).getTime(),
    updatedAt:    new Date(product.updatedAt).getTime(),
  };
}
