import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export interface RedirectRule {
  id: string;
  tenantId: string;
  source: string;
  destination: string;
  type: '301' | '302' | '307' | '308';
  isActive: boolean;
  description?: string;
  hits: number;
  lastHitAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RedirectStats {
  totalRules: number;
  activeRules: number;
  totalHits: number;
  topRedirects: Array<{
    source: string;
    destination: string;
    hits: number;
  }>;
}

/**
 * Redirect Service
 */
export class RedirectService {
  /**
   * Create redirect rule
   */
  static async createRedirectRule(
    tenantId: string,
    source: string,
    destination: string,
    type: '301' | '302' | '307' | '308' = '301',
    description?: string
  ): Promise<RedirectRule> {
    try {
      // Normalize URLs
      const normalizedSource = this.normalizeURL(source);
      const normalizedDestination = this.normalizeURL(destination);

      // Check if source already exists
      const existing = await prisma.redirectRule.findFirst({
        where: {
          tenantId,
          source: normalizedSource,
        },
      });

      if (existing) {
        throw new Error('Redirect rule for this source already exists');
      }

      const redirect = await prisma.redirectRule.create({
        data: {
          tenantId,
          source: normalizedSource,
          destination: normalizedDestination,
          type,
          description,
        },
      });

      logger.info('[Redirect] Redirect rule created', {
        tenantId,
        source: normalizedSource,
        destination: normalizedDestination,
        type,
      });

      return redirect;
    } catch (error) {
      logger.error('[Redirect] Error creating redirect rule', { error, tenantId, source });
      throw error;
    }
  }

  /**
   * Update redirect rule
   */
  static async updateRedirectRule(
    tenantId: string,
    ruleId: string,
    updates: {
      source?: string;
      destination?: string;
      type?: '301' | '302' | '307' | '308';
      description?: string;
      isActive?: boolean;
    }
  ): Promise<RedirectRule> {
    try {
      const updateData: any = { ...updates };

      if (updates.source) {
        updateData.source = this.normalizeURL(updates.source);
      }

      if (updates.destination) {
        updateData.destination = this.normalizeURL(updates.destination);
      }

      const redirect = await prisma.redirectRule.update({
        where: {
          id: ruleId,
          tenantId,
        },
        data: updateData,
      });

      logger.info('[Redirect] Redirect rule updated', {
        tenantId,
        ruleId,
        updates,
      });

      return redirect;
    } catch (error) {
      logger.error('[Redirect] Error updating redirect rule', { error, tenantId, ruleId });
      throw error;
    }
  }

  /**
   * Delete redirect rule
   */
  static async deleteRedirectRule(tenantId: string, ruleId: string): Promise<void> {
    try {
      await prisma.redirectRule.delete({
        where: {
          id: ruleId,
          tenantId,
        },
      });

      logger.info('[Redirect] Redirect rule deleted', {
        tenantId,
        ruleId,
      });
    } catch (error) {
      logger.error('[Redirect] Error deleting redirect rule', { error, tenantId, ruleId });
      throw error;
    }
  }

  /**
   * Get redirect rules
   */
  static async getRedirectRules(
    tenantId: string,
    options: {
      page?: number;
      limit?: number;
      search?: string;
      isActive?: boolean;
      type?: string;
    } = {}
  ): Promise<{
    rules: RedirectRule[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    try {
      const { page = 1, limit = 20, search, isActive, type } = options;
      const skip = (page - 1) * limit;

      const where: any = { tenantId };

      if (search) {
        where.OR = [
          { source: { contains: search, mode: 'insensitive' } },
          { destination: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (isActive !== undefined) {
        where.isActive = isActive;
      }

      if (type) {
        where.type = type;
      }

      const [rules, total] = await Promise.all([
        prisma.redirectRule.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.redirectRule.count({ where }),
      ]);

      return {
        rules,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('[Redirect] Error getting redirect rules', { error, tenantId });
      throw error;
    }
  }

  /**
   * Find redirect for URL
   */
  static async findRedirect(tenantId: string, path: string): Promise<RedirectRule | null> {
    try {
      const normalizedPath = this.normalizeURL(path);

      const redirect = await prisma.redirectRule.findFirst({
        where: {
          tenantId,
          source: normalizedPath,
          isActive: true,
        },
      });

      if (redirect) {
        // Update hit count
        await prisma.redirectRule.update({
          where: { id: redirect.id },
          data: {
            hits: { increment: 1 },
            lastHitAt: new Date(),
          },
        });

        logger.debug('[Redirect] Redirect found', {
          tenantId,
          source: normalizedPath,
          destination: redirect.destination,
          hits: redirect.hits + 1,
        });
      }

      return redirect;
    } catch (error) {
      logger.error('[Redirect] Error finding redirect', { error, tenantId, path });
      return null;
    }
  }

  /**
   * Import redirect rules from CSV
   */
  static async importRedirectRules(
    tenantId: string,
    rules: Array<{
      source: string;
      destination: string;
      type?: '301' | '302' | '307' | '308';
      description?: string;
    }>
  ): Promise<{
    imported: number;
    skipped: number;
    errors: Array<{
      row: number;
      error: string;
    }>;
  }> {
    let imported = 0;
    let skipped = 0;
    const errors: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const rowNumber = i + 1;

      try {
        // Validate required fields
        if (!rule.source || !rule.destination) {
          errors.push({
            row: rowNumber,
            error: 'Source and destination are required',
          });
          continue;
        }

        // Check if already exists
        const existing = await prisma.redirectRule.findFirst({
          where: {
            tenantId,
            source: this.normalizeURL(rule.source),
          },
        });

        if (existing) {
          skipped++;
          continue;
        }

        // Create redirect rule
        await this.createRedirectRule(
          tenantId,
          rule.source,
          rule.destination,
          rule.type || '301',
          rule.description
        );

        imported++;
      } catch (error: any) {
        errors.push({
          row: rowNumber,
          error: error.message,
        });
      }
    }

    logger.info('[Redirect] Import completed', {
      tenantId,
      total: rules.length,
      imported,
      skipped,
      errors: errors.length,
    });

    return { imported, skipped, errors };
  }

  /**
   * Export redirect rules to CSV
   */
  static async exportRedirectRules(tenantId: string): Promise<string> {
    try {
      const rules = await prisma.redirectRule.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });

      const headers = ['Source', 'Destination', 'Type', 'Description', 'Hits', 'Created At'];
      const rows = rules.map(rule => [
        rule.source,
        rule.destination,
        rule.type,
        rule.description || '',
        rule.hits.toString(),
        rule.createdAt.toISOString(),
      ]);

      const csv = [headers, ...rows]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');

      return csv;
    } catch (error) {
      logger.error('[Redirect] Error exporting redirect rules', { error, tenantId });
      throw error;
    }
  }

  /**
   * Get redirect statistics
   */
  static async getRedirectStats(tenantId: string): Promise<RedirectStats> {
    try {
      const [totalRules, activeRules, totalHits, topRedirects] = await Promise.all([
        prisma.redirectRule.count({ where: { tenantId } }),
        prisma.redirectRule.count({ where: { tenantId, isActive: true } }),
        prisma.redirectRule.aggregate({
          where: { tenantId },
          _sum: { hits: true },
        }),
        prisma.redirectRule.findMany({
          where: { tenantId },
          orderBy: { hits: 'desc' },
          take: 10,
          select: {
            source: true,
            destination: true,
            hits: true,
          },
        }),
      ]);

      return {
        totalRules,
        activeRules,
        totalHits: totalHits._sum.hits || 0,
        topRedirects: topRedirects.map(r => ({
          source: r.source,
          destination: r.destination,
          hits: r.hits,
        })),
      };
    } catch (error) {
      logger.error('[Redirect] Error getting redirect stats', { error, tenantId });
      throw error;
    }
  }

  /**
   * Test redirect
   */
  static async testRedirect(tenantId: string, source: string): Promise<{
    found: boolean;
    redirect?: RedirectRule;
    destination?: string;
  }> {
    try {
      const redirect = await this.findRedirect(tenantId, source);

      if (redirect) {
        return {
          found: true,
          redirect,
          destination: redirect.destination,
        };
      }

      return { found: false };
    } catch (error) {
      logger.error('[Redirect] Error testing redirect', { error, tenantId, source });
      return { found: false };
    }
  }

  /**
   * Normalize URL
   */
  private static normalizeURL(url: string): string {
    // Remove domain if present
    let normalized = url;
    
    try {
      const urlObj = new URL(url);
      normalized = urlObj.pathname + urlObj.search;
    } catch {
      // URL is already relative or invalid, use as-is
    }

    // Ensure it starts with /
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }

    // Remove trailing slash unless it's root
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    // Convert to lowercase
    normalized = normalized.toLowerCase();

    return normalized;
  }

  /**
   * Auto-generate redirects for product changes
   */
  static async generateProductRedirects(
    tenantId: string,
    productId: string,
    oldSlug: string,
    newSlug: string
  ): Promise<void> {
    try {
      if (oldSlug === newSlug) {
        return;
      }

      const source = `/products/${oldSlug}`;
      const destination = `/products/${newSlug}`;
      const description = `Auto-generated redirect for product slug change`;

      await this.createRedirectRule(tenantId, source, destination, '301', description);

      logger.info('[Redirect] Auto-generated product redirect', {
        tenantId,
        productId,
        oldSlug,
        newSlug,
      });
    } catch (error) {
      logger.error('[Redirect] Error generating product redirect', {
        error,
        tenantId,
        productId,
        oldSlug,
        newSlug,
      });
    }
  }

  /**
   * Auto-generate redirects for category changes
   */
  static async generateCategoryRedirects(
    tenantId: string,
    categoryId: string,
    oldSlug: string,
    newSlug: string
  ): Promise<void> {
    try {
      if (oldSlug === newSlug) {
        return;
      }

      const source = `/categories/${oldSlug}`;
      const destination = `/categories/${newSlug}`;
      const description = `Auto-generated redirect for category slug change`;

      await this.createRedirectRule(tenantId, source, destination, '301', description);

      logger.info('[Redirect] Auto-generated category redirect', {
        tenantId,
        categoryId,
        oldSlug,
        newSlug,
      });
    } catch (error) {
      logger.error('[Redirect] Error generating category redirect', {
        error,
        tenantId,
        categoryId,
        oldSlug,
        newSlug,
      });
    }
  }
}

export const redirectService = RedirectService;
