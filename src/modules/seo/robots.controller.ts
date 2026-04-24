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

export class RobotsController {
  /**
   * Generate robots.txt
   */
  async generateRobots(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.headers['x-tenant-id'] as string;
      
      if (!tenantId) {
        res.status(400).send('Tenant ID required');
        return;
      }

      const robotsTxt = await seoService.generateRobotsTxt(tenantId);

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.send(robotsTxt);

      logger.info('[Robots] robots.txt generated', { tenantId });
    } catch (error) {
      logger.error('[Robots] Error generating robots.txt', { error });
      res.status(500).send('Error generating robots.txt');
    }
  }

  /**
   * Get custom robots.txt rules
   */
  async getRobotsRules(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Get tenant settings
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });

      const settings = (tenant as any)?.settings || {};
      const robotsSettings = settings.robots || {};

      res.json({
        success: true,
        data: {
          userAgent: robotsSettings.userAgent || '*',
          allow: robotsSettings.allow || ['/'],
          disallow: robotsSettings.disallow || [
            '/admin/',
            '/api/',
            '/cart/',
            '/checkout/',
            '/account/',
            '/search?',
            '/*.json$',
            '/*.xml$',
          ],
          crawlDelay: robotsSettings.crawlDelay,
          sitemaps: robotsSettings.sitemaps || ['/sitemap.xml'],
          customRules: robotsSettings.customRules || [],
        },
      });
    } catch (error) {
      logger.error('[Robots] Error getting robots rules', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update robots.txt rules
   */
  async updateRobotsRules(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const {
        userAgent,
        allow,
        disallow,
        crawlDelay,
        sitemaps,
        customRules,
      } = req.body;

      // Get current tenant settings
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });

      const currentSettings = (tenant as any)?.settings || {};
      const updatedSettings = {
        ...currentSettings,
        robots: {
          userAgent: userAgent || '*',
          allow: allow || ['/'],
          disallow: disallow || [
            '/admin/',
            '/api/',
            '/cart/',
            '/checkout/',
            '/account/',
            '/search?',
            '/*.json$',
            '/*.xml$',
          ],
          crawlDelay,
          sitemaps: sitemaps || ['/sitemap.xml'],
          customRules: customRules || [],
        },
      };

      // Update tenant settings
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          settings: updatedSettings,
        },
      });

      logger.info('[Robots] Robots rules updated', {
        tenantId,
        userAgent,
        allow,
        disallow,
        crawlDelay,
        sitemaps,
      });

      res.json({
        success: true,
        message: 'Robots rules updated successfully',
      });
    } catch (error) {
      logger.error('[Robots] Error updating robots rules', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Validate robots.txt rules
   */
  async validateRobotsRules(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { rules } = req.body;

      if (!rules) {
        res.status(400).json({ error: 'Rules are required' });
        return;
      }

      const validation = this.validateRobotsSyntax(rules);

      res.json({
        success: true,
        data: validation,
      });
    } catch (error) {
      logger.error('[Robots] Error validating robots rules', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Preview robots.txt
   */
  async previewRobots(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const {
        userAgent,
        allow,
        disallow,
        crawlDelay,
        sitemaps,
        customRules,
      } = req.body;

      const robotsTxt = this.generateRobotsContent({
        userAgent: userAgent || '*',
        allow: allow || ['/'],
        disallow: disallow || [
          '/admin/',
          '/api/',
          '/cart/',
          '/checkout/',
          '/account/',
          '/search?',
          '/*.json$',
          '/*.xml$',
        ],
        crawlDelay,
        sitemaps: sitemaps || ['/sitemap.xml'],
        customRules: customRules || [],
      });

      res.json({
        success: true,
        data: {
          robotsTxt,
        },
      });
    } catch (error) {
      logger.error('[Robots] Error previewing robots', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Generate robots.txt content
   */
  private generateRobotsContent(rules: {
    userAgent: string;
    allow: string[];
    disallow: string[];
    crawlDelay?: number;
    sitemaps: string[];
    customRules: string[];
  }): string {
    const lines: string[] = [];

    // User-agent
    lines.push(`User-agent: ${rules.userAgent}`);

    // Allow rules
    rules.allow.forEach(rule => {
      lines.push(`Allow: ${rule}`);
    });

    // Disallow rules
    rules.disallow.forEach(rule => {
      lines.push(`Disallow: ${rule}`);
    });

    // Crawl delay
    if (rules.crawlDelay) {
      lines.push(`Crawl-delay: ${rules.crawlDelay}`);
    }

    // Custom rules
    rules.customRules.forEach(rule => {
      lines.push(rule);
    });

    // Empty line before sitemaps
    lines.push('');

    // Sitemaps
    rules.sitemaps.forEach(sitemap => {
      lines.push(`Sitemap: ${sitemap}`);
    });

    return lines.join('\n');
  }

  /**
   * Validate robots.txt syntax
   */
  private validateRobotsSyntax(rules: any): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    if (!rules.userAgent) {
      errors.push('User-agent is required');
    }

    if (!rules.allow || !Array.isArray(rules.allow)) {
      errors.push('Allow rules must be an array');
    }

    if (!rules.disallow || !Array.isArray(rules.disallow)) {
      errors.push('Disallow rules must be an array');
    }

    // Validate paths
    if (rules.allow) {
      rules.allow.forEach((rule: string, index: number) => {
        if (!rule.startsWith('/')) {
          warnings.push(`Allow rule ${index + 1} should start with /`);
        }
      });
    }

    if (rules.disallow) {
      rules.disallow.forEach((rule: string, index: number) => {
        if (!rule.startsWith('/')) {
          warnings.push(`Disallow rule ${index + 1} should start with /`);
        }
      });
    }

    // Validate crawl delay
    if (rules.crawlDelay !== undefined) {
      if (typeof rules.crawlDelay !== 'number' || rules.crawlDelay < 0) {
        errors.push('Crawl delay must be a positive number');
      }
    }

    // Validate sitemaps
    if (rules.sitemaps) {
      if (!Array.isArray(rules.sitemaps)) {
        errors.push('Sitemaps must be an array');
      } else {
        rules.sitemaps.forEach((sitemap: string, index: number) => {
          if (!sitemap.startsWith('http')) {
            warnings.push(`Sitemap ${index + 1} should be a full URL`);
          }
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Test robots.txt against a URL
   */
  async testRobots(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { userAgent = '*', url } = req.body;

      if (!url) {
        res.status(400).json({ error: 'URL is required' });
        return;
      }

      // Get robots rules
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });

      const settings = (tenant as any)?.settings || {};
      const robotsSettings = settings.robots || {};

      // Test URL against rules
      const isAllowed = this.testUrlAgainstRules(url, userAgent, robotsSettings);

      res.json({
        success: true,
        data: {
          url,
          userAgent,
          isAllowed,
        },
      });
    } catch (error) {
      logger.error('[Robots] Error testing robots', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Test URL against robots rules
   */
  private testUrlAgainstRules(
    url: string,
    userAgent: string,
    rules: any
  ): boolean {
    // Simple implementation - in production, use a proper robots.txt parser
    const path = new URL(url).pathname;

    // Check disallow rules
    if (rules.disallow) {
      for (const rule of rules.disallow) {
        if (this.matchPath(path, rule)) {
          return false;
        }
      }
    }

    // Check allow rules
    if (rules.allow) {
      for (const rule of rules.allow) {
        if (this.matchPath(path, rule)) {
          return true;
        }
      }
    }

    return true;
  }

  /**
   * Simple path matching (wildcard support)
   */
  private matchPath(path: string, rule: string): boolean {
    if (rule === '/') {
      return true;
    }

    if (rule.includes('*')) {
      const regex = new RegExp(rule.replace(/\*/g, '.*'));
      return regex.test(path);
    }

    if (rule.includes('$')) {
      const regex = new RegExp(rule.replace(/\$$/, '$'));
      return regex.test(path);
    }

    return path.startsWith(rule);
  }
}

export const robotsController = new RobotsController();
