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
    const { tenantSlug } = req.params;
    
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

    // Get all products and categories
    const [products, categories] = await Promise.all([
      prisma.product.findMany({
        where: {
          tenantId: tenant.id,
          isActive: true
        },
        include: {
          category: true
        }
      }),
      prisma.category.findMany({
        where: {
          tenantId: tenant.id,
          isActive: true
        }
      })
    ]);

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://${tenant.slug}.woontegra.com/</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  ${products.map(product => `
  <url>
    <loc>https://${tenant.slug}.woontegra.com/product/${product.slug}</loc>
    <lastmod>${product.updatedAt.toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
  `).join('')}
  ${categories.map(category => `
  <url>
    <loc>https://${tenant.slug}.woontegra.com/category/${category.slug}</loc>
    <lastmod>${category.updatedAt.toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  `).join('')}
</urlset>
</sitemap>`;

    res.setHeader('Content-Type', 'application/xml');
    res.send(sitemap);
  });

  // Generate robots.txt
  generateRobotsTxt = asyncHandler(async (req: Request, res: Response) => {
    const { tenantSlug } = req.params;
    
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

    const robotsTxt = `User-agent: *
Allow: /

# Store pages
${products.map(product => `Allow: /product/${product.slug}`).join('\n')}

# Category pages
${categories.map(category => `Allow: /category/${category.slug}`).join('\n')}

# Sitemap
Allow: /sitemap/${tenantSlug}.xml

# Disallow
Disallow: /admin/*
Disallow: /api/*
Disallow: /dashboard/*
Disallow: /cart/*

# Crawl delay
Crawl-delay: 1

# Host
Host: ${tenant.slug}.woontegra.com
Sitemap: https://${tenantSlug}.woontegra.com/sitemap/${tenantSlug}.xml`;

    res.setHeader('Content-Type', 'text/plain');
    res.send(robotsTxt);
  });
}
