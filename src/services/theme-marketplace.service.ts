import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

export interface ThemeManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  repository?: string;
  license: string;
  category: 'ecommerce' | 'business' | 'portfolio' | 'blog' | 'minimal' | 'modern' | 'classic';
  tags: string[];
  preview: {
    screenshot: string;
    thumbnail: string;
    livePreview?: string;
  };
  features: string[];
  requirements: {
    woontegra: string;
    node?: string;
    browser?: string[];
  };
  assets: {
    css?: string[];
    js?: string[];
    fonts?: string[];
  };
}

export interface Theme {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  category: string;
  tags: string[];
  manifest: ThemeManifest;
  isActive: boolean;
  isInstalled: boolean;
  installPath?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class ThemeMarketplaceService {
  private static themesDir = path.join(process.cwd(), 'themes');

  /**
   * Discover available themes
   */
  static async discoverThemes(search?: string, category?: string): Promise<Theme[]> {
    try {
      let themes = await prisma.theme.findMany({
        where: {
          isActive: true,
          ...(category && { category }),
          ...(search && {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
              { tags: { has: search } },
            ],
          }),
        },
        orderBy: { name: 'asc' },
      });

      return themes.map((t: any) => this.formatTheme(t));
    } catch (error) {
      logger.error('Theme discovery failed:', error);
      throw error;
    }
  }

  /**
   * Install a theme
   */
  static async installTheme(themeId: string, tenantId: string): Promise<Theme> {
    try {
      const theme = await prisma.theme.findUnique({
        where: { id: themeId },
      });

      if (!theme) {
        throw new Error('Theme not found');
      }

      if (theme.isInstalled) {
        throw new Error('Theme is already installed');
      }

      // Create theme directory
      const themePath = path.join(this.themesDir, themeId);
      if (!fs.existsSync(themePath)) {
        fs.mkdirSync(themePath, { recursive: true });
      }

      // Download and extract theme files
      await this.downloadThemeFiles(theme, themePath);

      // Update theme status
      const updatedTheme = await prisma.theme.update({
        where: { id: themeId },
        data: {
          isInstalled: true,
          installPath: themePath,
          updatedAt: new Date(),
        },
      });

      // Create tenant theme record
      await prisma.tenantTheme.create({
        data: {
          tenantId,
          themeId,
          isActive: false,
          settings: {},
        },
      });

      logger.info(`Theme installed: ${theme.name}`, { themeId, tenantId });

      return this.formatTheme(updatedTheme);
    } catch (error) {
      logger.error('Theme installation failed:', error);
      throw error;
    }
  }

  /**
   * Activate a theme for a tenant
   */
  static async activateTheme(themeId: string, tenantId: string): Promise<Theme> {
    try {
      // Deactivate current theme
      await prisma.tenantTheme.updateMany({
        where: { tenantId },
        data: { isActive: false },
      });

      // Activate new theme
      await prisma.tenantTheme.updateMany({
        where: { tenantId, themeId },
        data: { isActive: true },
      });

      const theme = await prisma.theme.update({
        where: { id: themeId },
        data: { updatedAt: new Date() },
      });

      logger.info(`Theme activated: ${theme.name}`, { themeId, tenantId });

      return this.formatTheme(theme);
    } catch (error) {
      logger.error('Theme activation failed:', error);
      throw error;
    }
  }

  /**
   * Deactivate a theme
   */
  static async deactivateTheme(themeId: string, tenantId: string): Promise<Theme> {
    try {
      await prisma.tenantTheme.updateMany({
        where: { tenantId, themeId },
        data: { isActive: false },
      });

      const theme = await prisma.theme.findUnique({
        where: { id: themeId },
      });

      logger.info(`Theme deactivated: ${theme?.name}`, { themeId, tenantId });

      return this.formatTheme(theme!);
    } catch (error) {
      logger.error('Theme deactivation failed:', error);
      throw error;
    }
  }

  /**
   * Uninstall a theme
   */
  static async uninstallTheme(themeId: string, tenantId: string): Promise<void> {
    try {
      const theme = await prisma.theme.findUnique({
        where: { id: themeId },
      });

      if (!theme) {
        throw new Error('Theme not found');
      }

      if (!theme.isInstalled) {
        throw new Error('Theme is not installed');
      }

      // Remove theme directory
      if (theme.installPath && fs.existsSync(theme.installPath)) {
        fs.rmSync(theme.installPath, { recursive: true, force: true });
      }

      // Delete tenant theme record
      await prisma.tenantTheme.deleteMany({
        where: { tenantId, themeId },
      });

      // Update theme status
      await prisma.theme.update({
        where: { id: themeId },
        data: {
          isInstalled: false,
          installPath: null,
          updatedAt: new Date(),
        },
      });

      logger.info(`Theme uninstalled: ${theme.name}`, { themeId, tenantId });
    } catch (error) {
      logger.error('Theme uninstallation failed:', error);
      throw error;
    }
  }

  /**
   * Update theme settings
   */
  static async updateThemeSettings(
    themeId: string,
    tenantId: string,
    settings: Record<string, any>
  ): Promise<Theme> {
    try {
      await prisma.tenantTheme.updateMany({
        where: { tenantId, themeId },
        data: {
          settings,
          updatedAt: new Date(),
        },
      });

      const theme = await prisma.theme.findUnique({
        where: { id: themeId },
      });

      logger.info(`Theme settings updated: ${theme?.name}`, { themeId, tenantId });

      return this.formatTheme(theme!);
    } catch (error) {
      logger.error('Theme settings update failed:', error);
      throw error;
    }
  }

  /**
   * Get active theme for tenant
   */
  static async getActiveTheme(tenantId: string): Promise<Theme | null> {
    try {
      const tenantTheme = await prisma.tenantTheme.findFirst({
        where: { tenantId, isActive: true },
        include: { theme: true },
      });

      if (!tenantTheme?.theme) {
        return null;
      }

      return this.formatTheme(tenantTheme.theme);
    } catch (error) {
      logger.error('Get active theme failed:', error);
      throw error;
    }
  }

  /**
   * Validate theme manifest
   */
  static validateManifest(manifest: any): manifest is ThemeManifest {
    const required = ['name', 'version', 'description', 'author', 'license', 'category'];
    
    for (const field of required) {
      if (!manifest[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    return true;
  }

  /**
   * Format theme object
   */
  private static formatTheme(theme: any): Theme {
    return {
      id: theme.id,
      name: theme.name,
      version: theme.version,
      description: theme.description,
      author: theme.author,
      license: theme.license,
      category: theme.category,
      tags: theme.tags || [],
      manifest: theme.manifest || {},
      isActive: theme.isActive,
      isInstalled: theme.isInstalled,
      installPath: theme.installPath,
      createdAt: theme.createdAt,
      updatedAt: theme.updatedAt,
    };
  }

  /**
   * Download theme files
   */
  private static async downloadThemeFiles(theme: any, targetPath: string): Promise<void> {
    // Placeholder for theme download logic
    // In production, this would download from a CDN or repository
    logger.info(`Downloading theme files for: ${theme.name}`, { themeId: theme.id });
  }

  /**
   * Check theme compatibility
   */
  static checkCompatibility(theme: Theme, woontegraVersion: string): boolean {
    const minVersion = theme.manifest?.requirements?.woontegra;
    
    if (!minVersion) {
      return true; // No requirements specified
    }

    // Simple version comparison (semver-like)
    return this.compareVersions(woontegraVersion, minVersion) >= 0;
  }

  /**
   * Compare version strings
   */
  private static compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }

    return 0;
  }
}

export default ThemeMarketplaceService;
