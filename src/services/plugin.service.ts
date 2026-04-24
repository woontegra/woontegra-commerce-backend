import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  repository?: string;
  license: string;
  main: string;
  category: 'payment' | 'shipping' | 'analytics' | 'seo' | 'security' | 'ui' | 'integration' | 'other';
  permissions: string[];
  dependencies?: Record<string, string>;
  woontegra: {
    minVersion: string;
    maxVersion?: string;
    hooks: string[];
    settings: Record<string, any>;
  };
}

export interface Plugin {
  id: string;
  tenantId: string;
  name: string;
  version: string;
  status: 'active' | 'inactive' | 'error';
  manifest: PluginManifest;
  settings: Record<string, any>;
  installedAt: Date;
  updatedAt: Date;
}

export interface PluginHook {
  name: string;
  priority: number;
  handler: Function;
  pluginId: string;
}

/**
 * Plugin Service
 */
export class PluginService {
  private static hooks: Map<string, PluginHook[]> = new Map();
  private static loadedPlugins: Map<string, any> = new Map();

  /**
   * Install plugin
   */
  static async installPlugin(
    tenantId: string,
    pluginPath: string,
    settings: Record<string, any> = {}
  ): Promise<Plugin> {
    try {
      // Read plugin manifest
      const manifestPath = path.join(pluginPath, 'plugin.json');
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest: PluginManifest = JSON.parse(manifestContent);

      // Validate manifest
      this.validateManifest(manifest);

      // Check if plugin already exists
      const existing = await prisma.plugin.findFirst({
        where: {
          tenantId,
          name: manifest.name,
        },
      });

      if (existing) {
        throw new Error(`Plugin ${manifest.name} is already installed`);
      }

      // Check dependencies
      await this.checkDependencies(manifest.dependencies);

      // Load plugin module
      const pluginModule = await this.loadPluginModule(pluginPath, manifest.main);

      // Install plugin hooks
      if (manifest.woontegra.hooks.length > 0) {
        await this.installPluginHooks(tenantId, manifest.name, pluginModule, manifest.woontegra.hooks);
      }

      // Create plugin record
      const plugin = await prisma.plugin.create({
        data: {
          tenantId,
          name: manifest.name,
          version: manifest.version,
          status: 'active',
          manifest,
          settings,
        },
      });

      // Store loaded plugin
      this.loadedPlugins.set(`${tenantId}:${manifest.name}`, pluginModule);

      logger.info('[Plugin] Plugin installed', {
        tenantId,
        pluginName: manifest.name,
        version: manifest.version,
      });

      return plugin;
    } catch (error) {
      logger.error('[Plugin] Error installing plugin', { error, tenantId, pluginPath });
      throw error;
    }
  }

  /**
   * Uninstall plugin
   */
  static async uninstallPlugin(tenantId: string, pluginName: string): Promise<void> {
    try {
      // Get plugin
      const plugin = await prisma.plugin.findFirst({
        where: {
          tenantId,
          name: pluginName,
        },
      });

      if (!plugin) {
        throw new Error('Plugin not found');
      }

      // Uninstall hooks
      await this.uninstallPluginHooks(tenantId, pluginName);

      // Remove loaded plugin
      this.loadedPlugins.delete(`${tenantId}:${pluginName}`);

      // Delete plugin record
      await prisma.plugin.delete({
        where: {
          id: plugin.id,
        },
      });

      logger.info('[Plugin] Plugin uninstalled', {
        tenantId,
        pluginName,
      });
    } catch (error) {
      logger.error('[Plugin] Error uninstalling plugin', { error, tenantId, pluginName });
      throw error;
    }
  }

  /**
   * Activate plugin
   */
  static async activatePlugin(tenantId: string, pluginName: string): Promise<void> {
    try {
      const plugin = await prisma.plugin.findFirst({
        where: {
          tenantId,
          name: pluginName,
        },
      });

      if (!plugin) {
        throw new Error('Plugin not found');
      }

      // Load plugin if not already loaded
      const pluginKey = `${tenantId}:${pluginName}`;
      if (!this.loadedPlugins.has(pluginKey)) {
        const pluginModule = await this.loadPluginModule(
          `/plugins/${pluginName}`,
          plugin.manifest.main
        );
        this.loadedPlugins.set(pluginKey, pluginModule);
      }

      // Install hooks
      if (plugin.manifest.woontegra.hooks.length > 0) {
        const pluginModule = this.loadedPlugins.get(pluginKey);
        await this.installPluginHooks(
          tenantId,
          pluginName,
          pluginModule,
          plugin.manifest.woontegra.hooks
        );
      }

      // Update plugin status
      await prisma.plugin.update({
        where: {
          id: plugin.id,
        },
        data: {
          status: 'active',
        },
      });

      logger.info('[Plugin] Plugin activated', {
        tenantId,
        pluginName,
      });
    } catch (error) {
      logger.error('[Plugin] Error activating plugin', { error, tenantId, pluginName });
      throw error;
    }
  }

  /**
   * Deactivate plugin
   */
  static async deactivatePlugin(tenantId: string, pluginName: string): Promise<void> {
    try {
      const plugin = await prisma.plugin.findFirst({
        where: {
          tenantId,
          name: pluginName,
        },
      });

      if (!plugin) {
        throw new Error('Plugin not found');
      }

      // Uninstall hooks
      await this.uninstallPluginHooks(tenantId, pluginName);

      // Update plugin status
      await prisma.plugin.update({
        where: {
          id: plugin.id,
        },
        data: {
          status: 'inactive',
        },
      });

      logger.info('[Plugin] Plugin deactivated', {
        tenantId,
        pluginName,
      });
    } catch (error) {
      logger.error('[Plugin] Error deactivating plugin', { error, tenantId, pluginName });
      throw error;
    }
  }

  /**
   * Get installed plugins
   */
  static async getInstalledPlugins(tenantId: string): Promise<Plugin[]> {
    try {
      const plugins = await prisma.plugin.findMany({
        where: {
          tenantId,
        },
        orderBy: {
          installedAt: 'desc',
        },
      });

      return plugins;
    } catch (error) {
      logger.error('[Plugin] Error getting installed plugins', { error, tenantId });
      throw error;
    }
  }

  /**
   * Get plugin by name
   */
  static async getPlugin(tenantId: string, pluginName: string): Promise<Plugin | null> {
    try {
      const plugin = await prisma.plugin.findFirst({
        where: {
          tenantId,
          name: pluginName,
        },
      });

      return plugin;
    } catch (error) {
      logger.error('[Plugin] Error getting plugin', { error, tenantId, pluginName });
      return null;
    }
  }

  /**
   * Update plugin settings
   */
  static async updatePluginSettings(
    tenantId: string,
    pluginName: string,
    settings: Record<string, any>
  ): Promise<void> {
    try {
      const plugin = await prisma.plugin.findFirst({
        where: {
          tenantId,
          name: pluginName,
        },
      });

      if (!plugin) {
        throw new Error('Plugin not found');
      }

      // Validate settings against manifest
      this.validateSettings(plugin.manifest, settings);

      // Update settings
      await prisma.plugin.update({
        where: {
          id: plugin.id,
        },
        data: {
          settings,
        },
      });

      // Notify plugin of settings change
      const pluginKey = `${tenantId}:${pluginName}`;
      const pluginModule = this.loadedPlugins.get(pluginKey);
      if (pluginModule && typeof pluginModule.onSettingsChange === 'function') {
        await pluginModule.onSettingsChange(settings);
      }

      logger.info('[Plugin] Plugin settings updated', {
        tenantId,
        pluginName,
      });
    } catch (error) {
      logger.error('[Plugin] Error updating plugin settings', { error, tenantId, pluginName });
      throw error;
    }
  }

  /**
   * Register hook
   */
  static registerHook(
    hookName: string,
    handler: Function,
    pluginId: string,
    priority: number = 10
  ): void {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }

    const hooks = this.hooks.get(hookName)!;
    hooks.push({ name: hookName, priority, handler, pluginId });

    // Sort by priority (lower = higher priority)
    hooks.sort((a, b) => a.priority - b.priority);

    logger.debug('[Plugin] Hook registered', {
      hookName,
      pluginId,
      priority,
    });
  }

  /**
   * Execute hook
   */
  static async executeHook(hookName: string, data: any = {}): Promise<any> {
    const hooks = this.hooks.get(hookName) || [];
    let result = data;

    for (const hook of hooks) {
      try {
        result = await hook.handler(result);
      } catch (error) {
        logger.error('[Plugin] Hook execution failed', {
          hookName,
          pluginId: hook.pluginId,
          error,
        });
      }
    }

    return result;
  }

  /**
   * Load plugin module
   */
  private static async loadPluginModule(pluginPath: string, mainFile: string): Promise<any> {
    try {
      const fullPath = path.resolve(pluginPath, mainFile);
      const pluginModule = require(fullPath);
      return pluginModule;
    } catch (error) {
      logger.error('[Plugin] Error loading plugin module', { error, pluginPath, mainFile });
      throw new Error(`Failed to load plugin module: ${error.message}`);
    }
  }

  /**
   * Install plugin hooks
   */
  private static async installPluginHooks(
    tenantId: string,
    pluginName: string,
    pluginModule: any,
    hooks: string[]
  ): Promise<void> {
    for (const hookName of hooks) {
      if (typeof pluginModule[hookName] === 'function') {
        this.registerHook(hookName, pluginModule[hookName], `${tenantId}:${pluginName}`);
      }
    }
  }

  /**
   * Uninstall plugin hooks
   */
  private static async uninstallPluginHooks(tenantId: string, pluginName: string): Promise<void> {
    const pluginId = `${tenantId}:${pluginName}`;

    for (const [hookName, hooks] of this.hooks.entries()) {
      const filteredHooks = hooks.filter(hook => hook.pluginId !== pluginId);
      this.hooks.set(hookName, filteredHooks);
    }
  }

  /**
   * Validate plugin manifest
   */
  private static validateManifest(manifest: PluginManifest): void {
    const required = ['name', 'version', 'description', 'author', 'main', 'category', 'permissions', 'woontegra'];
    
    for (const field of required) {
      if (!manifest[field as keyof PluginManifest]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate version format
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      throw new Error('Invalid version format (expected x.y.z)');
    }

    // Validate category
    const validCategories = ['payment', 'shipping', 'analytics', 'seo', 'security', 'ui', 'integration', 'other'];
    if (!validCategories.includes(manifest.category)) {
      throw new Error(`Invalid category: ${manifest.category}`);
    }
  }

  /**
   * Check plugin dependencies
   */
  private static async checkDependencies(dependencies?: Record<string, string>): Promise<void> {
    if (!dependencies) return;

    for (const [name, version] of Object.entries(dependencies)) {
      // TODO: Implement dependency checking
      logger.debug('[Plugin] Checking dependency', { name, version });
    }
  }

  /**
   * Validate plugin settings
   */
  private static validateSettings(manifest: PluginManifest, settings: Record<string, any>): void {
    const schema = manifest.woontegra.settings;

    for (const [key, config] of Object.entries(schema)) {
      const settingConfig = config as any;
      const value = settings[key];

      if (settingConfig.required && (value === undefined || value === null)) {
        throw new Error(`Required setting missing: ${key}`);
      }

      if (value !== undefined && settingConfig.type) {
        if (settingConfig.type === 'string' && typeof value !== 'string') {
          throw new Error(`Setting ${key} must be a string`);
        }
        if (settingConfig.type === 'number' && typeof value !== 'number') {
          throw new Error(`Setting ${key} must be a number`);
        }
        if (settingConfig.type === 'boolean' && typeof value !== 'boolean') {
          throw new Error(`Setting ${key} must be a boolean`);
        }
      }
    }
  }

  /**
   * Get available plugins from marketplace
   */
  static async getAvailablePlugins(category?: string): Promise<any[]> {
    try {
      // TODO: Implement plugin marketplace integration
      // For now, return mock data
      const mockPlugins = [
        {
          name: 'stripe-payment',
          version: '1.0.0',
          description: 'Stripe payment gateway integration',
          author: 'Woontegra',
          category: 'payment',
          price: 0,
          rating: 4.5,
          downloads: 1250,
          icon: 'https://example.com/stripe-icon.png',
        },
        {
          name: 'google-analytics',
          version: '1.0.0',
          description: 'Google Analytics integration',
          author: 'Woontegra',
          category: 'analytics',
          price: 0,
          rating: 4.8,
          downloads: 2100,
          icon: 'https://example.com/ga-icon.png',
        },
      ];

      if (category) {
        return mockPlugins.filter(plugin => plugin.category === category);
      }

      return mockPlugins;
    } catch (error) {
      logger.error('[Plugin] Error getting available plugins', { error });
      return [];
    }
  }

  /**
   * Download plugin from marketplace
   */
  static async downloadPlugin(pluginName: string): Promise<string> {
    try {
      // TODO: Implement plugin download from marketplace
      // For now, return mock path
      const pluginPath = `/tmp/plugins/${pluginName}`;
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(pluginPath)) {
        fs.mkdirSync(pluginPath, { recursive: true });
      }

      return pluginPath;
    } catch (error) {
      logger.error('[Plugin] Error downloading plugin', { error, pluginName });
      throw error;
    }
  }
}

export const pluginService = PluginService;
