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
    css: string[];
    js: string[];
    images: string[];
    fonts: string[];
  };
  customization: {
    colors: Record<string, string>;
    fonts: Record<string, string>;
    layout: Record<string, any>;
  };
  woontegra: {
    minVersion: string;
    maxVersion?: string;
    hooks: string[];
    settings: Record<string, any>;
  };
}

export interface Theme {
  id: string;
  tenantId: string;
  name: string;
  version: string;
  status: 'active' | 'inactive' | 'preview';
  isCustom: boolean;
  manifest: ThemeManifest;
  settings: Record<string, any>;
  customizations: Record<string, any>;
  installedAt: Date;
  updatedAt: Date;
}

export interface ThemeAsset {
  id: string;
  themeId: string;
  type: 'css' | 'js' | 'image' | 'font';
  filename: string;
  path: string;
  size: number;
  hash: string;
  createdAt: Date;
}

/**
 * Theme Marketplace Service
 */
export class ThemeMarketplaceService {
  /**
   * Get available themes from marketplace
   */
  static async getAvailableThemes(category?: string, tags?: string[]): Promise<any[]> {
    try {
      // TODO: Implement theme marketplace integration
      // For now, return mock data
      const mockThemes = [
        {
          id: 'modern-minimal',
          name: 'Modern Minimal',
          version: '1.2.0',
          description: 'Clean and minimal design for modern stores',
          author: 'Woontegra Team',
          category: 'minimal',
          tags: ['minimal', 'clean', 'modern', 'responsive'],
          price: 0,
          rating: 4.8,
          downloads: 3500,
          preview: {
            thumbnail: 'https://example.com/themes/modern-minimal/thumb.jpg',
            screenshot: 'https://example.com/themes/modern-minimal/preview.jpg',
            livePreview: 'https://demo-modern-minimal.woontegra.com',
          },
          features: [
            'Responsive design',
            'Product grid/list view',
            'Quick view modal',
            'Wishlist support',
            'Advanced search',
            'Multi-language support',
          ],
          compatibility: {
            woontegra: '>=1.0.0',
            browsers: ['Chrome', 'Firefox', 'Safari', 'Edge'],
          },
          isNew: true,
          isPopular: true,
        },
        {
          id: 'classic-shop',
          name: 'Classic Shop',
          version: '2.1.0',
          description: 'Traditional e-commerce design with modern features',
          author: 'Theme Masters',
          category: 'ecommerce',
          tags: ['classic', 'traditional', 'ecommerce', 'feature-rich'],
          price: 49.99,
          rating: 4.6,
          downloads: 1800,
          preview: {
            thumbnail: 'https://example.com/themes/classic-shop/thumb.jpg',
            screenshot: 'https://example.com/themes/classic-shop/preview.jpg',
            livePreview: 'https://demo-classic-shop.woontegra.com',
          },
          features: [
            'Mega menu support',
            'Product comparison',
            'Advanced filtering',
            'Product reviews',
            'Multi-currency support',
            'SEO optimized',
          ],
          compatibility: {
            woontegra: '>=1.0.0',
            browsers: ['Chrome', 'Firefox', 'Safari', 'Edge'],
          },
          isNew: false,
          isPopular: true,
        },
        {
          id: 'business-pro',
          name: 'Business Pro',
          version: '1.5.0',
          description: 'Professional theme for B2B and service businesses',
          author: 'Business Themes Co',
          category: 'business',
          tags: ['business', 'professional', 'b2b', 'corporate'],
          price: 79.99,
          rating: 4.7,
          downloads: 950,
          preview: {
            thumbnail: 'https://example.com/themes/business-pro/thumb.jpg',
            screenshot: 'https://example.com/themes/business-pro/preview.jpg',
            livePreview: 'https://demo-business-pro.woontegra.com',
          },
          features: [
            'Quote request system',
            'Client dashboard',
            'Service listings',
            'Team showcase',
            'Testimonials',
            'Case studies',
          ],
          compatibility: {
            woontegra: '>=1.2.0',
            browsers: ['Chrome', 'Firefox', 'Safari', 'Edge'],
          },
          isNew: false,
          isPopular: false,
        },
      ];

      let filteredThemes = mockThemes;

      if (category) {
        filteredThemes = filteredThemes.filter(theme => theme.category === category);
      }

      if (tags && tags.length > 0) {
        filteredThemes = filteredThemes.filter(theme =>
          tags.some(tag => theme.tags.includes(tag))
        );
      }

      return filteredThemes;
    } catch (error) {
      logger.error('[ThemeMarketplace] Error getting available themes', { error });
      return [];
    }
  }

  /**
   * Get theme details
   */
  static async getThemeDetails(themeId: string): Promise<any> {
    try {
      const availableThemes = await this.getAvailableThemes();
      const theme = availableThemes.find(t => t.id === themeId);

      if (!theme) {
        throw new Error('Theme not found');
      }

      // Get additional details
      const details = {
        ...theme,
        changelog: [
          {
            version: '1.2.0',
            date: '2024-01-15',
            changes: [
              'Added dark mode support',
              'Improved mobile navigation',
              'Fixed cart dropdown issues',
            ],
          },
          {
            version: '1.1.0',
            date: '2023-12-01',
            changes: [
              'Added quick view feature',
              'Improved performance',
              'Updated dependencies',
            ],
          },
        ],
        requirements: {
          woontegra: '>=1.0.0',
          node: '>=16.0.0',
          browsers: ['Chrome 90+', 'Firefox 88+', 'Safari 14+', 'Edge 90+'],
        },
        support: {
          documentation: `https://docs.woontegra.com/themes/${themeId}`,
          supportEmail: 'support@woontegra.com',
          community: 'https://community.woontegra.com',
        },
        reviews: [
          {
            id: '1',
            user: 'John Doe',
            rating: 5,
            title: 'Excellent Theme',
            comment: 'Beautiful design and easy to customize. Highly recommended!',
            date: '2024-01-10',
            helpful: 15,
          },
          {
            id: '2',
            user: 'Jane Smith',
            rating: 4,
            title: 'Great but needs improvements',
            comment: 'Good overall design but could use more customization options.',
            date: '2024-01-05',
            helpful: 8,
          },
        ],
      };

      return details;
    } catch (error) {
      logger.error('[ThemeMarketplace] Error getting theme details', { error, themeId });
      throw error;
    }
  }

  /**
   * Install theme
   */
  static async installTheme(
    tenantId: string,
    themeId: string,
    settings: Record<string, any> = {}
  ): Promise<Theme> {
    try {
      // Get theme details
      const themeDetails = await this.getThemeDetails(themeId);

      // Download theme files
      const themePath = await this.downloadTheme(themeId);

      // Read theme manifest
      const manifestPath = path.join(themePath, 'theme.json');
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest: ThemeManifest = JSON.parse(manifestContent);

      // Validate manifest
      this.validateManifest(manifest);

      // Check compatibility
      this.checkCompatibility(manifest);

      // Create theme record
      const theme = await prisma.theme.create({
        data: {
          tenantId,
          name: manifest.name,
          version: manifest.version,
          status: 'inactive',
          isCustom: false,
          manifest,
          settings,
          customizations: manifest.customization || {},
        },
      });

      // Process theme assets
      await this.processThemeAssets(theme.id, themePath, manifest);

      // Activate theme if no active theme exists
      const activeTheme = await prisma.theme.findFirst({
        where: {
          tenantId,
          status: 'active',
        },
      });

      if (!activeTheme) {
        await this.activateTheme(tenantId, theme.id);
      }

      logger.info('[ThemeMarketplace] Theme installed', {
        tenantId,
        themeId,
        themeName: manifest.name,
        version: manifest.version,
      });

      return theme;
    } catch (error) {
      logger.error('[ThemeMarketplace] Error installing theme', { error, tenantId, themeId });
      throw error;
    }
  }

  /**
   * Activate theme
   */
  static async activateTheme(tenantId: string, themeId: string): Promise<void> {
    try {
      // Get theme
      const theme = await prisma.theme.findFirst({
        where: {
          id: themeId,
          tenantId,
        },
      });

      if (!theme) {
        throw new Error('Theme not found');
      }

      // Deactivate all other themes
      await prisma.theme.updateMany({
        where: {
          tenantId,
          status: 'active',
        },
        data: {
          status: 'inactive',
        },
      });

      // Activate this theme
      await prisma.theme.update({
        where: {
          id: theme.id,
        },
        data: {
          status: 'active',
        },
      });

      // Generate theme CSS
      await this.generateThemeCSS(theme);

      logger.info('[ThemeMarketplace] Theme activated', {
        tenantId,
        themeId,
        themeName: theme.name,
      });
    } catch (error) {
      logger.error('[ThemeMarketplace] Error activating theme', { error, tenantId, themeId });
      throw error;
    }
  }

  /**
   * Deactivate theme
   */
  static async deactivateTheme(tenantId: string, themeId: string): Promise<void> {
    try {
      const theme = await prisma.theme.findFirst({
        where: {
          id: themeId,
          tenantId,
        },
      });

      if (!theme) {
        throw new Error('Theme not found');
      }

      // Don't allow deactivating the only active theme
      const activeThemes = await prisma.theme.count({
        where: {
          tenantId,
          status: 'active',
        },
      });

      if (activeThemes <= 1 && theme.status === 'active') {
        throw new Error('Cannot deactivate the only active theme');
      }

      // Deactivate theme
      await prisma.theme.update({
        where: {
          id: theme.id,
        },
        data: {
          status: 'inactive',
        },
      });

      logger.info('[ThemeMarketplace] Theme deactivated', {
        tenantId,
        themeId,
        themeName: theme.name,
      });
    } catch (error) {
      logger.error('[ThemeMarketplace] Error deactivating theme', { error, tenantId, themeId });
      throw error;
    }
  }

  /**
   * Uninstall theme
   */
  static async uninstallTheme(tenantId: string, themeId: string): Promise<void> {
    try {
      const theme = await prisma.theme.findFirst({
        where: {
          id: themeId,
          tenantId,
        },
      });

      if (!theme) {
        throw new Error('Theme not found');
      }

      // Don't allow uninstalling active theme
      if (theme.status === 'active') {
        throw new Error('Cannot uninstall active theme');
      }

      // Delete theme assets
      await this.deleteThemeAssets(themeId);

      // Delete theme record
      await prisma.theme.delete({
        where: {
          id: theme.id,
        },
      });

      logger.info('[ThemeMarketplace] Theme uninstalled', {
        tenantId,
        themeId,
        themeName: theme.name,
      });
    } catch (error) {
      logger.error('[ThemeMarketplace] Error uninstalling theme', { error, tenantId, themeId });
      throw error;
    }
  }

  /**
   * Get installed themes
   */
  static async getInstalledThemes(tenantId: string): Promise<Theme[]> {
    try {
      const themes = await prisma.theme.findMany({
        where: {
          tenantId,
        },
        orderBy: {
          installedAt: 'desc',
        },
      });

      return themes;
    } catch (error) {
      logger.error('[ThemeMarketplace] Error getting installed themes', { error, tenantId });
      throw error;
    }
  }

  /**
   * Get active theme
   */
  static async getActiveTheme(tenantId: string): Promise<Theme | null> {
    try {
      const theme = await prisma.theme.findFirst({
        where: {
          tenantId,
          status: 'active',
        },
      });

      return theme;
    } catch (error) {
      logger.error('[ThemeMarketplace] Error getting active theme', { error, tenantId });
      return null;
    }
  }

  /**
   * Customize theme
   */
  static async customizeTheme(
    tenantId: string,
    themeId: string,
    customizations: Record<string, any>
  ): Promise<void> {
    try {
      const theme = await prisma.theme.findFirst({
        where: {
          id: themeId,
          tenantId,
        },
      });

      if (!theme) {
        throw new Error('Theme not found');
      }

      // Validate customizations
      this.validateCustomizations(theme.manifest, customizations);

      // Update customizations
      await prisma.theme.update({
        where: {
          id: theme.id,
        },
        data: {
          customizations,
        },
      });

      // Regenerate theme CSS if active
      if (theme.status === 'active') {
        await this.generateThemeCSS(theme);
      }

      logger.info('[ThemeMarketplace] Theme customized', {
        tenantId,
        themeId,
        themeName: theme.name,
      });
    } catch (error) {
      logger.error('[ThemeMarketplace] Error customizing theme', { error, tenantId, themeId });
      throw error;
    }
  }

  /**
   * Generate theme CSS
   */
  private static async generateThemeCSS(theme: Theme): Promise<void> {
    try {
      const customizations = theme.customizations;
      const manifest = theme.manifest;

      // Generate CSS variables
      const cssVariables = this.generateCSSVariables(customizations, manifest);

      // Create CSS file
      const cssContent = `
/* Generated by Woontegra Theme Engine */
:root {
${cssVariables}
}

/* Import theme base styles */
@import url('/themes/${theme.id}/assets/theme.css');
`;

      // Save CSS file
      const cssPath = path.join(process.cwd(), 'public', 'themes', theme.id, 'custom.css');
      fs.mkdirSync(path.dirname(cssPath), { recursive: true });
      fs.writeFileSync(cssPath, cssContent);

      logger.debug('[ThemeMarketplace] Theme CSS generated', {
        themeId: theme.id,
        themeName: theme.name,
      });
    } catch (error) {
      logger.error('[ThemeMarketplace] Error generating theme CSS', { error, themeId: theme.id });
      throw error;
    }
  }

  /**
   * Generate CSS variables
   */
  private static generateCSSVariables(
    customizations: Record<string, any>,
    manifest: ThemeManifest
  ): string {
    const variables: string[] = [];

    // Color variables
    if (customizations.colors) {
      for (const [key, value] of Object.entries(customizations.colors)) {
        variables.push(`  --color-${key}: ${value};`);
      }
    }

    // Font variables
    if (customizations.fonts) {
      for (const [key, value] of Object.entries(customizations.fonts)) {
        variables.push(`  --font-${key}: ${value};`);
      }
    }

    // Layout variables
    if (customizations.layout) {
      for (const [key, value] of Object.entries(customizations.layout)) {
        variables.push(`  --layout-${key}: ${value};`);
      }
    }

    return variables.join('\n');
  }

  /**
   * Download theme from marketplace
   */
  private static async downloadTheme(themeId: string): Promise<string> {
    try {
      // TODO: Implement theme download from marketplace
      // For now, return mock path
      const themePath = `/tmp/themes/${themeId}`;
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(themePath)) {
        fs.mkdirSync(themePath, { recursive: true });
      }

      return themePath;
    } catch (error) {
      logger.error('[ThemeMarketplace] Error downloading theme', { error, themeId });
      throw error;
    }
  }

  /**
   * Process theme assets
   */
  private static async processThemeAssets(
    themeId: string,
    themePath: string,
    manifest: ThemeManifest
  ): Promise<void> {
    try {
      const publicThemePath = path.join(process.cwd(), 'public', 'themes', themeId);
      fs.mkdirSync(publicThemePath, { recursive: true });

      // Copy CSS files
      if (manifest.assets.css) {
        const cssDir = path.join(publicThemePath, 'assets', 'css');
        fs.mkdirSync(cssDir, { recursive: true });

        for (const cssFile of manifest.assets.css) {
          const sourcePath = path.join(themePath, 'css', cssFile);
          const destPath = path.join(cssDir, cssFile);
          
          if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, destPath);
            
            // Create asset record
            await prisma.themeAsset.create({
              data: {
                themeId,
                type: 'css',
                filename: cssFile,
                path: destPath,
                size: fs.statSync(sourcePath).size,
                hash: this.calculateFileHash(sourcePath),
              },
            });
          }
        }
      }

      // Copy JS files
      if (manifest.assets.js) {
        const jsDir = path.join(publicThemePath, 'assets', 'js');
        fs.mkdirSync(jsDir, { recursive: true });

        for (const jsFile of manifest.assets.js) {
          const sourcePath = path.join(themePath, 'js', jsFile);
          const destPath = path.join(jsDir, jsFile);
          
          if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, destPath);
            
            // Create asset record
            await prisma.themeAsset.create({
              data: {
                themeId,
                type: 'js',
                filename: jsFile,
                path: destPath,
                size: fs.statSync(sourcePath).size,
                hash: this.calculateFileHash(sourcePath),
              },
            });
          }
        }
      }

      // Copy image files
      if (manifest.assets.images) {
        const imagesDir = path.join(publicThemePath, 'assets', 'images');
        fs.mkdirSync(imagesDir, { recursive: true });

        for (const imageFile of manifest.assets.images) {
          const sourcePath = path.join(themePath, 'images', imageFile);
          const destPath = path.join(imagesDir, imageFile);
          
          if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, destPath);
            
            // Create asset record
            await prisma.themeAsset.create({
              data: {
                themeId,
                type: 'image',
                filename: imageFile,
                path: destPath,
                size: fs.statSync(sourcePath).size,
                hash: this.calculateFileHash(sourcePath),
              },
            });
          }
        }
      }

      // Copy font files
      if (manifest.assets.fonts) {
        const fontsDir = path.join(publicThemePath, 'assets', 'fonts');
        fs.mkdirSync(fontsDir, { recursive: true });

        for (const fontFile of manifest.assets.fonts) {
          const sourcePath = path.join(themePath, 'fonts', fontFile);
          const destPath = path.join(fontsDir, fontFile);
          
          if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, destPath);
            
            // Create asset record
            await prisma.themeAsset.create({
              data: {
                themeId,
                type: 'font',
                filename: fontFile,
                path: destPath,
                size: fs.statSync(sourcePath).size,
                hash: this.calculateFileHash(sourcePath),
              },
            });
          }
        }
      }

      logger.info('[ThemeMarketplace] Theme assets processed', {
        themeId,
        assetCount: manifest.assets.css.length + manifest.assets.js.length + manifest.assets.images.length + manifest.assets.fonts.length,
      });
    } catch (error) {
      logger.error('[ThemeMarketplace] Error processing theme assets', { error, themeId });
      throw error;
    }
  }

  /**
   * Delete theme assets
   */
  private static async deleteThemeAssets(themeId: string): Promise<void> {
    try {
      // Delete asset records
      await prisma.themeAsset.deleteMany({
        where: {
          themeId,
        },
      });

      // Delete theme directory
      const themePath = path.join(process.cwd(), 'public', 'themes', themeId);
      if (fs.existsSync(themePath)) {
        fs.rmSync(themePath, { recursive: true, force: true });
      }

      logger.info('[ThemeMarketplace] Theme assets deleted', { themeId });
    } catch (error) {
      logger.error('[ThemeMarketplace] Error deleting theme assets', { error, themeId });
      throw error;
    }
  }

  /**
   * Calculate file hash
   */
  private static calculateFileHash(filePath: string): string {
    const fileContent = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileContent).digest('hex');
  }

  /**
   * Validate theme manifest
   */
  private static validateManifest(manifest: ThemeManifest): void {
    const required = ['name', 'version', 'description', 'author', 'category', 'preview', 'assets', 'woontegra'];
    
    for (const field of required) {
      if (!manifest[field as keyof ThemeManifest]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate version format
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      throw new Error('Invalid version format (expected x.y.z)');
    }

    // Validate category
    const validCategories = ['ecommerce', 'business', 'portfolio', 'blog', 'minimal', 'modern', 'classic'];
    if (!validCategories.includes(manifest.category)) {
      throw new Error(`Invalid category: ${manifest.category}`);
    }
  }

  /**
   * Check theme compatibility
   */
  private static checkCompatibility(manifest: ThemeManifest): void {
    const currentVersion = '1.0.0'; // Get from package.json or config
    
    // Simple version comparison
    const requiredVersion = manifest.requirements.woontegra;
    if (requiredVersion && !this.isVersionCompatible(currentVersion, requiredVersion)) {
      throw new Error(`Theme requires Woontegra ${requiredVersion}, but current version is ${currentVersion}`);
    }
  }

  /**
   * Check version compatibility
   */
  private static isVersionCompatible(current: string, required: string): boolean {
    // Simple implementation - in production, use semver library
    const currentParts = current.split('.').map(Number);
    const requiredParts = required.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (currentParts[i] > requiredParts[i]) return true;
      if (currentParts[i] < requiredParts[i]) return false;
    }

    return true;
  }

  /**
   * Validate customizations
   */
  private static validateCustomizations(
    manifest: ThemeManifest,
    customizations: Record<string, any>
  ): void {
    const schema = manifest.customization;

    // Validate colors
    if (customizations.colors && schema.colors) {
      for (const [key, value] of Object.entries(customizations.colors)) {
        if (!schema.colors[key]) {
          throw new Error(`Invalid color customization: ${key}`);
        }
        
        if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value as string)) {
          throw new Error(`Invalid color value for ${key}: ${value}`);
        }
      }
    }

    // Validate fonts
    if (customizations.fonts && schema.fonts) {
      for (const [key, value] of Object.entries(customizations.fonts)) {
        if (!schema.fonts[key]) {
          throw new Error(`Invalid font customization: ${key}`);
        }
        
        if (typeof value !== 'string') {
          throw new Error(`Invalid font value for ${key}: ${value}`);
        }
      }
    }
  }
}

export const themeMarketplaceService = ThemeMarketplaceService;
