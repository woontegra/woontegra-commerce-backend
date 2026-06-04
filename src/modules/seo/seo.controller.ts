import { Request, Response } from 'express';
import prisma from '../../config/database';
import { asyncHandler } from '../../common/middleware/errorHandler';
import { createNotFoundError } from '../../common/middleware/AppError';
import { 
  generateProductStructuredData, 
  generateCategoryStructuredData, 
  generateStoreStructuredData,
  generateProductPageStructuredData,
  generateCategoryPageStructuredData,
  generateStorePageStructuredData
} from '../../common/utils/structured-data.utils';
import {
  escapeXmlLoc,
  resolveStorefrontAbsoluteUrl,
  storefrontCategoryPath,
  storefrontHomePath,
  storefrontProductPath,
  storefrontProductsListPath,
  storefrontUsesCustomDomain,
} from '../store-public/store-public-seo.util';

const STOREFRONT_ROBOTS_DISALLOW = [
  '/store/sepet',
  '/store/odeme',
  '/store/hesabim',
  '/store/giris',
  '/store/kayit',
  '/store/sifremi-unuttum',
  '/store/sifre-sifirla',
  '/store/odeme-basarili',
  '/store/odeme-basarisiz',
  '/store/odeme-bekleniyor',
  '/store/siparis-basarili',
  '/store/odeme/paytr',
  '/store/odeme/iyzico',
] as const;

type SitemapUrlEntry = {
  loc: string;
  lastmod?: Date;
  changefreq?: string;
  priority?: string;
};

function resolveSeoSitemapEndpointUrl(req: Request, tenantSlug: string): string {
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  const apiBase = host ? `${proto}://${host}` : '';
  const path = `/api/seo/sitemap/${encodeURIComponent(tenantSlug)}.xml`;
  return apiBase ? `${apiBase}${path}` : path;
}

function buildSitemapXml(entries: SitemapUrlEntry[]): string {
  const body = entries
    .map(entry => {
      const loc = escapeXmlLoc(entry.loc);
      const lastmod = entry.lastmod
        ? `\n    <lastmod>${entry.lastmod.toISOString()}</lastmod>`
        : '';
      const changefreq = entry.changefreq
        ? `\n    <changefreq>${entry.changefreq}</changefreq>`
        : '';
      const priority = entry.priority
        ? `\n    <priority>${entry.priority}</priority>`
        : '';
      return `  <url>\n    <loc>${loc}</loc>${lastmod}${changefreq}${priority}\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}

export class SEOController {
  // Get store data by tenant slug
  getStoreBySlug = asyncHandler(async (req: Request, res: Response) => {
    const { tenantSlug } = req.params;
    
    // Find tenant by slug
    const tenant = await prisma.tenant.findFirst({
      where: { 
        slug: tenantSlug,
        isActive: true 
      },
      include: {
        settings: true,
      products: {
          include: {
            category: true
          }
        },
        categories: {
          where: { isActive: true }
        }
      }
    });

    if (!tenant) {
      throw createNotFoundError('Store not found');
    }

    // Get all products for this tenant
    const products = await prisma.product.findMany({
      where: {
        tenantId: tenant.id,
        isActive: true
      },
      include: {
        category: true
      }
    });

    // Get all categories for this tenant
    const categories = await prisma.category.findMany({
      where: {
        tenantId: tenant.id,
        isActive: true
      }
    });

    res.json({
      success: true,
      data: {
        store: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          description: tenant.description,
          logo: tenant.logo,
          website: tenant.website,
          email: tenant.email,
          phone: tenant.phone,
          address: tenant.address,
          city: tenant.city,
          country: tenant.country,
          isActive: tenant.isActive,
          products: products.map(product => ({
            id: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            price: product.price,
            basePrice: product.basePrice,
            images: product.images,
            seoTitle: product.seoTitle,
            seoDescription: product.seoDescription,
            category: product.category ? {
              id: product.category.id,
              name: product.category.name,
              slug: product.category.slug,
              description: product.category.description,
              seoTitle: product.category.seoTitle,
              seoDescription: product.category.seoDescription
            } : null
          })),
          categories: categories.map(category => ({
            id: category.id,
            name: category.name,
            slug: category.slug,
            description: category.description,
            seoTitle: category.seoTitle,
            seoDescription: category.seoDescription,
            parentId: category.parentId,
            children: category.children?.map(child => ({
              id: child.id,
              name: child.name,
              slug: child.slug,
              description: child.description,
              seoTitle: child.seoTitle,
              seoDescription: child.seoDescription
            }))
          }))
        },
        structuredData: generateStoreStructuredData(tenant)
      }
    });
  });

  // Get product by slug
  getProductBySlug = asyncHandler(async (req: Request, res: Response) => {
    const { tenantSlug, productSlug } = req.params;
    
    // Find tenant
    const tenant = await prisma.tenant.findFirst({
      where: { 
        slug: tenantSlug,
        isActive: true 
      }
    });

    if (!tenant) {
      throw createNotFoundError('Store not found');
    }

    // Find product with category
    const product = await prisma.product.findFirst({
      where: {
        slug: productSlug,
        tenantId: tenant.id,
        isActive: true
      },
      include: {
        category: true
      }
    });

    if (!product) {
      throw createNotFoundError('Product not found');
    }

    res.json({
      success: true,
      data: {
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug,
          description: product.description,
          price: product.price,
          basePrice: product.basePrice,
          images: product.images,
          seoTitle: product.seoTitle,
          seoDescription: product.seoDescription,
          category: product.category ? {
            id: product.category.id,
            name: product.category.name,
            slug: product.category.slug,
            description: product.category.description,
            seoTitle: product.category.seoTitle,
            seoDescription: product.category.seoDescription,
            parentId: product.category.parentId,
            children: product.category.children?.map(child => ({
              id: child.id,
              name: child.name,
              slug: child.slug,
              description: child.description,
              seoTitle: child.seoTitle,
              seoDescription: child.seoDescription
            }))
          } : null,
          variants: product.variants,
          customFields: product.customFields,
          unitType: product.unitType,
          unitValue: product.unitValue,
          minQuantity: product.minQuantity,
          maxQuantity: product.maxQuantity,
          stepQuantity: product.stepQuantity,
          isActive: product.isActive,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt
        },
        structuredData: generateProductStructuredData(product, tenant)
      }
    });
  });

  // Get category by slug
  getCategoryBySlug = asyncHandler(async (req: Request, res: Response) => {
    const { tenantSlug, categorySlug } = req.params;
    
    // Find tenant
    const tenant = await prisma.tenant.findFirst({
      where: { 
        slug: tenantSlug,
        isActive: true 
      }
    });

    if (!tenant) {
      throw createNotFoundError('Store not found');
    }

    // Find category
    const category = await prisma.category.findFirst({
      where: {
        slug: categorySlug,
        tenantId: tenant.id,
        isActive: true
      },
      include: {
        parent: true,
        children: true
      }
    });

    if (!category) {
      throw createNotFoundError('Category not found');
    }

    res.json({
      success: true,
      data: {
        category: {
          id: category.id,
          name: category.name,
          slug: category.slug,
          description: category.description,
          seoTitle: category.seoTitle,
          seoDescription: category.seoDescription,
          parentId: category.parentId,
          parent: category.parent ? {
            id: category.parent.id,
            name: category.parent.name,
            slug: category.parent.slug,
            description: category.parent.description,
            seoTitle: category.parent.seoTitle,
            seoDescription: category.parent.seoDescription
          } : null,
          children: category.children?.map(child => ({
            id: child.id,
            name: child.name,
            slug: child.slug,
            description: child.description,
            seoTitle: child.seoTitle,
            seoDescription: child.seoDescription
          }))
        },
        structuredData: generateCategoryStructuredData(category, tenant)
      }
    });
  });

  // Generate sitemap
  generateSitemap = asyncHandler(async (req: Request, res: Response) => {
    const tenantSlug = typeof req.params.tenantSlug === 'string' ? req.params.tenantSlug.trim() : '';

    const tenant = await prisma.tenant.findFirst({
      where: {
        slug: tenantSlug,
        isActive: true,
      },
      select: {
        id: true,
        slug: true,
        customDomain: true,
        domainVerified: true,
      },
    });

    if (!tenant) {
      throw createNotFoundError('Store not found');
    }

    const useCustom = storefrontUsesCustomDomain(tenant.customDomain, tenant.domainVerified);
    const abs = (path: string) =>
      resolveStorefrontAbsoluteUrl(
        tenant.slug,
        path,
        tenant.customDomain,
        tenant.domainVerified,
      );

    const [products, categories] = await Promise.all([
      prisma.product.findMany({
        where: {
          tenantId: tenant.id,
          isActive: true,
          status: 'active',
        },
        select: {
          slug: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.category.findMany({
        where: {
          tenantId: tenant.id,
          isActive: true,
        },
        select: {
          slug: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const now = new Date();
    const entries: SitemapUrlEntry[] = [
      {
        loc: abs(storefrontHomePath(tenant.slug, useCustom)),
        lastmod: now,
        changefreq: 'daily',
        priority: '1.0',
      },
      {
        loc: abs(storefrontProductsListPath(tenant.slug, useCustom)),
        lastmod: now,
        changefreq: 'daily',
        priority: '0.9',
      },
      ...categories.map(category => ({
        loc: abs(storefrontCategoryPath(category.slug, tenant.slug, useCustom)),
        lastmod: category.updatedAt,
        changefreq: 'weekly',
        priority: '0.7',
      })),
      ...products.map(product => ({
        loc: abs(storefrontProductPath(product.slug, tenant.slug, useCustom)),
        lastmod: product.updatedAt,
        changefreq: 'weekly',
        priority: '0.6',
      })),
    ];

    res.setHeader('Content-Type', 'application/xml');
    res.send(buildSitemapXml(entries));
  });

  // Generate robots.txt
  generateRobotsTxt = asyncHandler(async (req: Request, res: Response) => {
    const tenantSlug = typeof req.params.tenantSlug === 'string' ? req.params.tenantSlug.trim() : '';

    const tenant = await prisma.tenant.findFirst({
      where: {
        slug: tenantSlug,
        isActive: true,
      },
      select: { slug: true },
    });

    if (!tenant) {
      throw createNotFoundError('Store not found');
    }

    const sitemapUrl = resolveSeoSitemapEndpointUrl(req, tenant.slug);
    const lines = [
      'User-agent: *',
      'Allow: /',
      '',
      ...STOREFRONT_ROBOTS_DISALLOW.map(path => `Disallow: ${path}`),
      '',
      'Disallow: /admin/',
      'Disallow: /api/',
      'Disallow: /dashboard/',
      '',
      `Sitemap: ${sitemapUrl}`,
    ];

    res.setHeader('Content-Type', 'text/plain');
    res.send(lines.join('\n'));
  });
}
