import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export interface SEOMetadata {
  title?: string;
  description?: string;
  keywords?: string;
  canonical?: string;
  robots?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogType?: string;
  twitterCard?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  jsonLd?: any;
}

export interface SEOPage {
  path: string;
  tenantId: string;
  metadata: SEOMetadata;
  isActive: boolean;
}

export interface CanonicalURL {
  path: string;
  canonical: string;
  tenantId: string;
}

/**
 * SEO Service
 */
export class SEOService {
  /**
   * Generate SEO metadata for product
   */
  static generateProductSEO(product: any, tenant: any): SEOMetadata {
    const baseUrl = tenant.settings?.seo?.baseUrl || 'https://example.com';
    const productUrl = `${baseUrl}/products/${product.slug}`;

    return {
      title: `${product.name} - ${tenant.name}`,
      description: product.description?.substring(0, 160) || `${product.name} satın alın. ${tenant.name} güvencesiyle.`,
      keywords: `${product.name},${product.category?.name},${product.brand?.name},online alışveriş`,
      canonical: productUrl,
      robots: 'index,follow',
      ogTitle: product.name,
      ogDescription: product.description?.substring(0, 160) || `${product.name} - ${tenant.name}`,
      ogImage: product.images?.[0] || '',
      ogType: 'product',
      twitterCard: 'product',
      twitterTitle: product.name,
      twitterDescription: product.description?.substring(0, 160) || `${product.name} - ${tenant.name}`,
      twitterImage: product.images?.[0] || '',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: product.description,
        image: product.images || [],
        brand: {
          '@type': 'Brand',
          name: product.brand?.name || tenant.name,
        },
        offers: {
          '@type': 'Offer',
          price: product.pricing?.salePrice || 0,
          priceCurrency: product.pricing?.currency || 'TRY',
          availability: product.stock?.quantity > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          seller: {
            '@type': 'Organization',
            name: tenant.name,
          },
        },
      },
    };
  }

  /**
   * Generate SEO metadata for category
   */
  static generateCategorySEO(category: any, tenant: any): SEOMetadata {
    const baseUrl = tenant.settings?.seo?.baseUrl || 'https://example.com';
    const categoryUrl = `${baseUrl}/categories/${category.slug}`;

    return {
      title: `${category.name} - ${tenant.name}`,
      description: category.description?.substring(0, 160) || `${category.name} kategorisindeki tüm ürünler. ${tenant.name} güvencesiyle.`,
      keywords: `${category.name},${category.path?.join(',')},online alışveriş`,
      canonical: categoryUrl,
      robots: 'index,follow',
      ogTitle: category.name,
      ogDescription: category.description?.substring(0, 160) || `${category.name} - ${tenant.name}`,
      ogImage: category.image || '',
      ogType: 'website',
      twitterCard: 'summary_large_image',
      twitterTitle: category.name,
      twitterDescription: category.description?.substring(0, 160) || `${category.name} - ${tenant.name}`,
      twitterImage: category.image || '',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: category.name,
        description: category.description,
        url: categoryUrl,
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: category._count?.products || 0,
        },
      },
    };
  }

  /**
   * Save SEO metadata
   */
  static async saveSEOMetadata(
    tenantId: string,
    path: string,
    metadata: SEOMetadata
  ): Promise<void> {
    try {
      await prisma.seOMetadata.upsert({
        where: {
          tenantId_path: {
            tenantId,
            path,
          },
        },
        create: {
          tenantId,
          path,
          metadata,
        },
        update: {
          metadata,
        },
      });

      logger.info('[SEO] Metadata saved', {
        tenantId,
        path,
      });
    } catch (error) {
      logger.error('[SEO] Error saving metadata', { error, tenantId, path });
      throw error;
    }
  }

  /**
   * Get SEO metadata
   */
  static async getSEOMetadata(tenantId: string, path: string): Promise<SEOMetadata | null> {
    try {
      const seoData = await prisma.seOMetadata.findUnique({
        where: {
          tenantId_path: {
            tenantId,
            path,
          },
        },
      });

      return seoData?.metadata as SEOMetadata || null;
    } catch (error) {
      logger.error('[SEO] Error getting metadata', { error, tenantId, path });
      return null;
    }
  }

  /**
   * Generate canonical URL
   */
  static generateCanonicalURL(
    tenantId: string,
    path: string,
    query?: Record<string, string>
  ): string {
    // Get tenant settings
    const tenant = prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    const baseUrl = (tenant as any)?.settings?.seo?.baseUrl || 'https://example.com';
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    
    let canonical = `${baseUrl}/${cleanPath}`;
    
    if (query && Object.keys(query).length > 0) {
      const queryString = new URLSearchParams(query).toString();
      canonical += `?${queryString}`;
    }

    return canonical;
  }

  /**
   * Save canonical URL
   */
  static async saveCanonicalURL(
    tenantId: string,
    path: string,
    canonical: string
  ): Promise<void> {
    try {
      await prisma.canonicalURL.upsert({
        where: {
          tenantId_path: {
            tenantId,
            path,
          },
        },
        create: {
          tenantId,
          path,
          canonical,
        },
        update: {
          canonical,
        },
      });

      logger.info('[SEO] Canonical URL saved', {
        tenantId,
        path,
        canonical,
      });
    } catch (error) {
      logger.error('[SEO] Error saving canonical URL', { error, tenantId, path });
      throw error;
    }
  }

  /**
   * Get canonical URL
   */
  static async getCanonicalURL(tenantId: string, path: string): Promise<string | null> {
    try {
      const canonicalData = await prisma.canonicalURL.findUnique({
        where: {
          tenantId_path: {
            tenantId,
            path,
          },
        },
      });

      return canonicalData?.canonical || null;
    } catch (error) {
      logger.error('[SEO] Error getting canonical URL', { error, tenantId, path });
      return null;
    }
  }

  /**
   * Generate robots.txt content
   */
  static generateRobotsTxt(tenantId: string): string {
    const robots = [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin/',
      'Disallow: /api/',
      'Disallow: /cart/',
      'Disallow: /checkout/',
      'Disallow: /account/',
      'Disallow: /search?',
      'Disallow: /*.json$',
      'Disallow: /*.xml$',
      '',
      'Sitemap: /sitemap.xml',
      '',
    ];

    return robots.join('\n');
  }

  /**
   * Generate sitemap URLs
   */
  static async generateSitemapURLs(tenantId: string): Promise<Array<{
    url: string;
    lastmod: string;
    changefreq: string;
    priority: number;
  }>> {
    const urls: Array<{
      url: string;
      lastmod: string;
      changefreq: string;
      priority: number;
    }> = [];

    // Get tenant settings
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true, slug: true },
    });

    const baseUrl = (tenant as any)?.settings?.seo?.baseUrl || 'https://example.com';

    // Add homepage
    urls.push({
      url: baseUrl,
      lastmod: new Date().toISOString(),
      changefreq: 'daily',
      priority: 1.0,
    });

    // Add product pages
    const products = await prisma.product.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      select: {
        slug: true,
        updatedAt: true,
      },
      take: 1000, // Limit to 1000 products
    });

    products.forEach(product => {
      urls.push({
        url: `${baseUrl}/products/${product.slug}`,
        lastmod: product.updatedAt.toISOString(),
        changefreq: 'weekly',
        priority: 0.8,
      });
    });

    // Add category pages
    const categories = await prisma.category.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      select: {
        slug: true,
        updatedAt: true,
      },
    });

    categories.forEach(category => {
      urls.push({
        url: `${baseUrl}/categories/${category.slug}`,
        lastmod: category.updatedAt.toISOString(),
        changefreq: 'weekly',
        priority: 0.7,
      });
    });

    return urls;
  }

  /**
   * Generate sitemap XML
   */
  static async generateSitemapXML(tenantId: string): Promise<string> {
    const urls = await this.generateSitemapURLs(tenantId);

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map(url => `
  <url>
    <loc>${url.url}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`),
      '</urlset>',
    ];

    return xml.join('\n');
  }

  /**
   * Auto-generate SEO metadata for products
   */
  static async autoGenerateProductSEO(tenantId: string, productId: string): Promise<void> {
    try {
      const [product, tenant] = await Promise.all([
        prisma.product.findUnique({
          where: { id: productId, tenantId },
          include: {
            category: true,
            brand: true,
            pricing: true,
            stock: true,
            images: true,
          },
        }),
        prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true, settings: true },
        }),
      ]);

      if (!product || !tenant) {
        return;
      }

      const metadata = this.generateProductSEO(product, tenant);
      await this.saveSEOMetadata(tenantId, `/products/${product.slug}`, metadata);

      logger.info('[SEO] Auto-generated product SEO', {
        tenantId,
        productId,
        productSlug: product.slug,
      });
    } catch (error) {
      logger.error('[SEO] Error auto-generating product SEO', {
        error,
        tenantId,
        productId,
      });
    }
  }

  /**
   * Auto-generate SEO metadata for categories
   */
  static async autoGenerateCategorySEO(tenantId: string, categoryId: string): Promise<void> {
    try {
      const [category, tenant] = await Promise.all([
        prisma.category.findUnique({
          where: { id: categoryId, tenantId },
          include: {
            _count: {
              select: { products: true },
            },
          },
        }),
        prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true, settings: true },
        }),
      ]);

      if (!category || !tenant) {
        return;
      }

      const metadata = this.generateCategorySEO(category, tenant);
      await this.saveSEOMetadata(tenantId, `/categories/${category.slug}`, metadata);

      logger.info('[SEO] Auto-generated category SEO', {
        tenantId,
        categoryId,
        categorySlug: category.slug,
      });
    } catch (error) {
      logger.error('[SEO] Error auto-generating category SEO', {
        error,
        tenantId,
        categoryId,
      });
    }
  }
}

export const seoService = SEOService;
