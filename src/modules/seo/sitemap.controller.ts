import { Request, Response } from 'express';
import { seoService } from '../../services/seo.service';
import { logger } from '../../config/logger';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
    email: string;
  };
}

export class SitemapController {
  /**
   * Generate sitemap.xml
   */
  async generateSitemap(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.headers['x-tenant-id'] as string;
      
      if (!tenantId) {
        res.status(400).send('Tenant ID required');
        return;
      }

      const sitemapXML = await seoService.generateSitemapXML(tenantId);

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.send(sitemapXML);

      logger.info('[Sitemap] Sitemap generated', { tenantId });
    } catch (error) {
      logger.error('[Sitemap] Error generating sitemap', { error });
      res.status(500).send('Error generating sitemap');
    }
  }

  /**
   * Generate sitemap index (for multiple sitemaps)
   */
  async generateSitemapIndex(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.headers['x-tenant-id'] as string;
      
      if (!tenantId) {
        res.status(400).send('Tenant ID required');
        return;
      }

      const baseUrl = req.protocol + '://' + req.get('host');
      
      const sitemapIndex = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        `  <sitemap>`,
        `    <loc>${baseUrl}/sitemap.xml</loc>`,
        `    <lastmod>${new Date().toISOString()}</lastmod>`,
        `  </sitemap>`,
        `  <sitemap>`,
        `    <loc>${baseUrl}/sitemap-products.xml</loc>`,
        `    <lastmod>${new Date().toISOString()}</lastmod>`,
        `  </sitemap>`,
        `  <sitemap>`,
        `    <loc>${baseUrl}/sitemap-categories.xml</loc>`,
        `    <lastmod>${new Date().toISOString()}</lastmod>`,
        `  </sitemap>`,
        '</sitemapindex>',
      ].join('\n');

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(sitemapIndex);

      logger.info('[Sitemap] Sitemap index generated', { tenantId });
    } catch (error) {
      logger.error('[Sitemap] Error generating sitemap index', { error });
      res.status(500).send('Error generating sitemap index');
    }
  }

  /**
   * Generate products sitemap
   */
  async generateProductsSitemap(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.headers['x-tenant-id'] as string;
      
      if (!tenantId) {
        res.status(400).send('Tenant ID required');
        return;
      }

      // Get tenant settings for base URL
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });

      const baseUrl = (tenant as any)?.settings?.seo?.baseUrl || req.protocol + '://' + req.get('host');

      // Get products
      const products = await prisma.product.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        select: {
          slug: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 50000, // Limit to 50k products per sitemap
      });

      const urls = products.map(product => [
        '  <url>',
        `    <loc>${baseUrl}/products/${product.slug}</loc>`,
        `    <lastmod>${product.updatedAt.toISOString()}</lastmod>`,
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.8</priority>',
        '  </url>',
      ]).join('\n');

      const sitemapXML = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        urls,
        '</urlset>',
      ].join('\n');

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(sitemapXML);

      logger.info('[Sitemap] Products sitemap generated', { 
        tenantId, 
        productCount: products.length 
      });
    } catch (error) {
      logger.error('[Sitemap] Error generating products sitemap', { error });
      res.status(500).send('Error generating products sitemap');
    }
  }

  /**
   * Generate categories sitemap
   */
  async generateCategoriesSitemap(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.headers['x-tenant-id'] as string;
      
      if (!tenantId) {
        res.status(400).send('Tenant ID required');
        return;
      }

      // Get tenant settings for base URL
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });

      const baseUrl = (tenant as any)?.settings?.seo?.baseUrl || req.protocol + '://' + req.get('host');

      // Get categories
      const categories = await prisma.category.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        select: {
          slug: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      });

      const urls = categories.map(category => [
        '  <url>',
        `    <loc>${baseUrl}/categories/${category.slug}</loc>`,
        `    <lastmod>${category.updatedAt.toISOString()}</lastmod>`,
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.7</priority>',
        '  </url>',
      ]).join('\n');

      const sitemapXML = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        urls,
        '</urlset>',
      ].join('\n');

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(sitemapXML);

      logger.info('[Sitemap] Categories sitemap generated', { 
        tenantId, 
        categoryCount: categories.length 
      });
    } catch (error) {
      logger.error('[Sitemap] Error generating categories sitemap', { error });
      res.status(500).send('Error generating categories sitemap');
    }
  }

  /**
   * Submit sitemap to search engines
   */
  async submitSitemap(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { searchEngines = ['google', 'bing'] } = req.body;

      // Get tenant settings for base URL
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });

      const baseUrl = (tenant as any)?.settings?.seo?.baseUrl || req.protocol + '://' + req.get('host');
      const sitemapUrl = `${baseUrl}/sitemap.xml`;

      const results = [];

      // Submit to Google
      if (searchEngines.includes('google')) {
        try {
          const response = await fetch(`https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
          results.push({
            engine: 'google',
            success: response.ok,
            status: response.status,
          });
        } catch (error) {
          results.push({
            engine: 'google',
            success: false,
            error: error.message,
          });
        }
      }

      // Submit to Bing
      if (searchEngines.includes('bing')) {
        try {
          const response = await fetch(`https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
          results.push({
            engine: 'bing',
            success: response.ok,
            status: response.status,
          });
        } catch (error) {
          results.push({
            engine: 'bing',
            success: false,
            error: error.message,
          });
        }
      }

      logger.info('[Sitemap] Sitemap submitted', {
        tenantId,
        sitemapUrl,
        searchEngines,
        results,
      });

      res.json({
        success: true,
        data: {
          sitemapUrl,
          results,
        },
      });
    } catch (error) {
      logger.error('[Sitemap] Error submitting sitemap', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get sitemap statistics
   */
  async getSitemapStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      const [productCount, categoryCount] = await Promise.all([
        prisma.product.count({
          where: {
            tenantId,
            isActive: true,
          },
        }),
        prisma.category.count({
          where: {
            tenantId,
            isActive: true,
          },
        }),
      ]);

      const stats = {
        totalUrls: productCount + categoryCount + 1, // +1 for homepage
        productUrls: productCount,
        categoryUrls: categoryCount,
        otherUrls: 1, // homepage
        lastGenerated: new Date().toISOString(),
      };

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('[Sitemap] Error getting sitemap stats', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const sitemapController = new SitemapController();
