import { PrismaClient, Prisma } from '@prisma/client';

export interface ProductFilters {
  categoryId?: string;
  categorySlug?: string;
  minPrice?: number;
  maxPrice?: number;
  attributes?: Record<string, string[]>; // { color: ['red', 'blue'], size: ['M', 'L'] }
  search?: string;
  brand?: string;
  inStock?: boolean;
  isActive?: boolean;
  sortBy?: 'price_asc' | 'price_desc' | 'name_asc' | 'name_desc' | 'newest' | 'popular';
  page?: number;
  limit?: number;
}

export interface FilterOptions {
  categories: Array<{ id: string; name: string; slug: string; count: number }>;
  priceRange: { min: number; max: number };
  attributes: Array<{
    id: string;
    name: string;
    slug: string;
    type: string;
    values: Array<{ value: string; label: string; count: number }>;
  }>;
  brands: Array<{ name: string; count: number }>;
}

export class ProductFilterService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get filtered products with optimized query
   * Uses indexed fields and efficient joins
   */
  async getFilteredProducts(tenantId: string, filters: ProductFilters) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100); // Max 100 items per page
    const skip = (page - 1) * limit;

    // Build where clause
    const where = this.buildWhereClause(tenantId, filters);

    // Build orderBy clause
    const orderBy = this.buildOrderByClause(filters.sortBy);

    // Execute queries in parallel for better performance
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          category: {
            select: { id: true, name: true, slug: true },
          },
          variants: {
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              price: true,
              discountPrice: true,
              stockQuantity: true,
              images: true,
              variantAttributes: {
                include: {
                  attribute: { select: { slug: true, name: true } },
                  attributeValue: { select: { value: true, label: true } },
                },
              },
            },
          },
          pricing: {
            select: {
              salePrice: true,
              discountPrice: true,
            },
          },
          stock: {
            select: {
              quantity: true,
            },
          },
          productImages: {
            where: { isMain: true },
            take: 1,
            select: { url: true },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      products,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };
  }

  /**
   * Get available filter options based on current filters
   * Optimized with aggregation queries
   */
  async getFilterOptions(tenantId: string, currentFilters: ProductFilters): Promise<FilterOptions> {
    const baseWhere = this.buildWhereClause(tenantId, { ...currentFilters, attributes: undefined });

    // Get categories with product counts (parallel execution)
    const [categories, priceAgg, attributes, brands] = await Promise.all([
      this.getCategoriesWithCounts(tenantId, baseWhere),
      this.getPriceRange(tenantId, baseWhere),
      this.getAttributesWithCounts(tenantId, baseWhere),
      this.getBrandsWithCounts(tenantId, baseWhere),
    ]);

    return {
      categories,
      priceRange: priceAgg,
      attributes,
      brands,
    };
  }

  /**
   * Build optimized WHERE clause with proper indexing
   */
  private buildWhereClause(tenantId: string, filters: ProductFilters): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = {
      tenantId,
      isActive: filters.isActive !== false,
      status: 'active',
    };

    // Category filter (indexed)
    if (filters.categoryId) {
      where.categoryId = filters.categoryId;
    } else if (filters.categorySlug) {
      where.category = {
        slug: filters.categorySlug,
      };
    }

    // Price range filter
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      where.price = {};
      if (filters.minPrice !== undefined) {
        where.price.gte = filters.minPrice;
      }
      if (filters.maxPrice !== undefined) {
        where.price.lte = filters.maxPrice;
      }
    }

    // Brand filter
    if (filters.brand) {
      where.brand = filters.brand;
    }

    // Stock filter
    if (filters.inStock) {
      where.stock = {
        quantity: { gt: 0 },
      };
    }

    // Search filter (full-text search on name and description)
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { sku: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Attribute filters (variant-based)
    if (filters.attributes && Object.keys(filters.attributes).length > 0) {
      where.variants = {
        some: {
          isActive: true,
          AND: Object.entries(filters.attributes).map(([attrSlug, values]) => ({
            variantAttributes: {
              some: {
                attribute: { slug: attrSlug },
                attributeValue: { value: { in: values } },
              },
            },
          })),
        },
      };
    }

    return where;
  }

  /**
   * Build ORDER BY clause
   */
  private buildOrderByClause(sortBy?: string): Prisma.ProductOrderByWithRelationInput {
    switch (sortBy) {
      case 'price_asc':
        return { price: 'asc' };
      case 'price_desc':
        return { price: 'desc' };
      case 'name_asc':
        return { name: 'asc' };
      case 'name_desc':
        return { name: 'desc' };
      case 'newest':
        return { createdAt: 'desc' };
      case 'popular':
        // Could be based on order count or views
        return { createdAt: 'desc' }; // Fallback
      default:
        return { createdAt: 'desc' };
    }
  }

  /**
   * Get categories with product counts
   */
  private async getCategoriesWithCounts(tenantId: string, baseWhere: Prisma.ProductWhereInput) {
    const categories = await this.prisma.category.findMany({
      where: {
        tenantId,
        isActive: true,
        products: {
          some: baseWhere,
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        _count: {
          select: {
            products: {
              where: baseWhere,
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      count: cat._count.products,
    }));
  }

  /**
   * Get price range (min/max)
   */
  private async getPriceRange(tenantId: string, baseWhere: Prisma.ProductWhereInput) {
    const result = await this.prisma.product.aggregate({
      where: baseWhere,
      _min: { price: true },
      _max: { price: true },
    });

    return {
      min: Number(result._min.price) || 0,
      max: Number(result._max.price) || 0,
    };
  }

  /**
   * Get attributes with value counts
   * Optimized with raw SQL for better performance
   */
  private async getAttributesWithCounts(tenantId: string, baseWhere: Prisma.ProductWhereInput) {
    // Get all attributes used in products
    const attributes = await this.prisma.attribute.findMany({
      where: {
        tenantId,
        isFilterable: true,
      },
      include: {
        values: {
          include: {
            variantAttributes: {
              where: {
                variant: {
                  isActive: true,
                  product: baseWhere,
                },
              },
              select: {
                id: true,
              },
            },
          },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });

    return attributes
      .map((attr) => ({
        id: attr.id,
        name: attr.name,
        slug: attr.slug,
        type: attr.type,
        values: attr.values
          .map((val) => ({
            value: val.value,
            label: val.label,
            count: val.variantAttributes.length,
          }))
          .filter((v) => v.count > 0)
          .sort((a, b) => b.count - a.count),
      }))
      .filter((attr) => attr.values.length > 0);
  }

  /**
   * Get brands with product counts
   */
  private async getBrandsWithCounts(tenantId: string, baseWhere: Prisma.ProductWhereInput) {
    const brands = await this.prisma.product.groupBy({
      by: ['brand'],
      where: {
        ...baseWhere,
        brand: { not: null },
      },
      _count: true,
      orderBy: {
        _count: {
          brand: 'desc',
        },
      },
    });

    return brands
      .filter((b) => b.brand)
      .map((b) => ({
        name: b.brand!,
        count: b._count,
      }));
  }

  /**
   * Parse URL query params to filters
   */
  parseQueryParams(query: Record<string, any>): ProductFilters {
    const filters: ProductFilters = {};

    // Category
    if (query.category) {
      filters.categorySlug = query.category;
    }

    // Price range
    if (query.minPrice) {
      filters.minPrice = parseFloat(query.minPrice);
    }
    if (query.maxPrice) {
      filters.maxPrice = parseFloat(query.maxPrice);
    }

    // Brand
    if (query.brand) {
      filters.brand = query.brand;
    }

    // Stock
    if (query.inStock === 'true') {
      filters.inStock = true;
    }

    // Search
    if (query.search || query.q) {
      filters.search = query.search || query.q;
    }

    // Sort
    if (query.sort) {
      filters.sortBy = query.sort;
    }

    // Pagination
    if (query.page) {
      filters.page = parseInt(query.page);
    }
    if (query.limit) {
      filters.limit = parseInt(query.limit);
    }

    // Attributes (dynamic)
    // Example: ?color=red,blue&size=M,L
    const attributes: Record<string, string[]> = {};
    Object.keys(query).forEach((key) => {
      if (!['category', 'minPrice', 'maxPrice', 'brand', 'inStock', 'search', 'q', 'sort', 'page', 'limit'].includes(key)) {
        const values = Array.isArray(query[key]) ? query[key] : query[key].split(',');
        attributes[key] = values.map((v: string) => v.trim());
      }
    });

    if (Object.keys(attributes).length > 0) {
      filters.attributes = attributes;
    }

    return filters;
  }
}
