import { PrismaClient, MarketplaceProvider, MarketplaceSyncStatus, SyncType } from '@prisma/client';
import { TrendyolClient, TrendyolCredentials } from './clients/trendyol.client';
import crypto from 'crypto';

export interface ConnectMarketplaceData {
  provider: MarketplaceProvider;
  apiKey: string;
  apiSecret: string;
  sellerId: string;
}

export interface ProductExportData {
  productId: string;
  marketplace: MarketplaceProvider;
  categoryId?: string;
  brandId?: string;
}

export interface StockPriceUpdateData {
  productId: string;
  marketplace: MarketplaceProvider;
  quantity: number;
  price: number;
}

export class MarketplaceService {
  constructor(private prisma: PrismaClient) {}

  // CONNECTION MANAGEMENT
  async connectMarketplace(tenantId: string, data: ConnectMarketplaceData): Promise<any> {
    try {
      // Validate credentials
      const isValid = await this.validateCredentials(data);
      if (!isValid) {
        throw new Error('Invalid marketplace credentials');
      }

      // Encrypt sensitive data
      const encryptedApiKey = this.encrypt(data.apiKey);
      const encryptedApiSecret = this.encrypt(data.apiSecret);

      // Check if account already exists
      const existingAccount = await this.prisma.marketplaceAccount.findFirst({
        where: {
          tenantId,
          provider: data.provider,
        },
      });

      if (existingAccount) {
        // Update existing account
        const updatedAccount = await this.prisma.marketplaceAccount.update({
          where: { id: existingAccount.id },
          data: {
            apiKey: encryptedApiKey,
            apiSecret: encryptedApiSecret,
            sellerId: data.sellerId,
            isActive: true,
            updatedAt: new Date(),
          },
        });
        return updatedAccount;
      } else {
        // Create new account
        const newAccount = await this.prisma.marketplaceAccount.create({
          data: {
            tenantId,
            provider: data.provider,
            apiKey: encryptedApiKey,
            apiSecret: encryptedApiSecret,
            sellerId: data.sellerId,
          },
        });
        return newAccount;
      }
    } catch (error) {
      throw new Error(`Failed to connect marketplace: ${error.message}`);
    }
  }

  async disconnectMarketplace(tenantId: string, provider: MarketplaceProvider): Promise<void> {
    try {
      await this.prisma.marketplaceAccount.updateMany({
        where: {
          tenantId,
          provider,
        },
        data: {
          isActive: false,
        },
      });
    } catch (error) {
      throw new Error(`Failed to disconnect marketplace: ${error.message}`);
    }
  }

  async getMarketplaceAccounts(tenantId: string): Promise<any[]> {
    try {
      const accounts = await this.prisma.marketplaceAccount.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          provider: true,
          sellerId: true,
          isActive: true,
          lastSyncAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return accounts;
    } catch (error) {
      throw new Error(`Failed to fetch marketplace accounts: ${error.message}`);
    }
  }

  // CREDENTIAL VALIDATION
  private async validateCredentials(data: ConnectMarketplaceData): Promise<boolean> {
    try {
      let client;
      
      switch (data.provider) {
        case 'TRENDYOL':
          client = new TrendyolClient({
            apiKey: data.apiKey,
            apiSecret: data.apiSecret,
            sellerId: data.sellerId,
          });
          return await client.healthCheck();
        
        default:
          throw new Error(`Unsupported provider: ${data.provider}`);
      }
    } catch (error) {
      return false;
    }
  }

  // PRODUCT EXPORT
  async exportProduct(tenantId: string, data: ProductExportData): Promise<any> {
    try {
      // Get marketplace account
      const account = await this.getMarketplaceAccount(tenantId, data.marketplace);
      if (!account) {
        throw new Error('Marketplace account not found');
      }

      // Get product details
      const product = await this.prisma.product.findFirst({
        where: {
          id: data.productId,
          tenantId,
        },
        include: {
          category: true,
          variants: true,
        },
      });

      if (!product) {
        throw new Error('Product not found');
      }

      // Check if already exported
      const existingMap = await this.prisma.marketplaceProductMap.findFirst({
        where: {
          tenantId,
          productId: data.productId,
          marketplace: data.marketplace,
        },
      });

      let result;
      
      switch (data.marketplace) {
        case 'TRENDYOL':
          result = await this.exportToTrendyol(account, product, existingMap, data);
          break;
        
        default:
          throw new Error(`Unsupported provider: ${data.marketplace}`);
      }

      // Create sync log
      await this.createSyncLog(tenantId, data.marketplace, SyncType.PRODUCT, {
        status: MarketplaceSyncStatus.COMPLETED,
        entityId: data.productId,
        externalId: result.externalId,
      });

      return result;
    } catch (error) {
      // Create error log
      await this.createSyncLog(tenantId, data.marketplace, SyncType.PRODUCT, {
        status: MarketplaceSyncStatus.FAILED,
        entityId: data.productId,
        errorMessage: error.message,
      });
      
      throw new Error(`Failed to export product: ${error.message}`);
    }
  }

  private async exportToTrendyol(account: any, product: any, existingMap: any, data: ProductExportData): Promise<any> {
    const credentials = this.decryptCredentials(account);
    const client = new TrendyolClient(credentials);

    const trendyolProduct = {
      barcode: product.sku || `SKU-${product.id}`,
      title: product.name,
      description: product.description || '',
      price: Number(product.price),
      currency: 'TRY',
      quantity: 1, // Will be updated with stock info
      categoryId: data.categoryId || '100123', // Default category
      brandId: data.brandId || '12345', // Default brand
      images: product.images || [],
      attributes: this.mapProductAttributes(product),
      variantAttributes: product.variants?.map((variant: any) => ({
        barcode: variant.sku,
        title: variant.name,
        price: Number(variant.price),
        attributes: this.mapVariantAttributes(variant),
      })),
    };

    let result;
    if (existingMap) {
      // Update existing product
      await client.updateProduct(trendyolProduct.barcode, trendyolProduct);
      result = { externalId: existingMap.externalId, updated: true };
    } else {
      // Create new product
      const createdProduct = await client.createProduct(trendyolProduct);
      result = { externalId: createdProduct.id, created: true };
    }

    // Update product map
    await this.updateProductMap(account.tenantId, data.productId, data.marketplace, result.externalId);

    return result;
  }

  // STOCK & PRICE SYNC
  async updateStockAndPrice(tenantId: string, updates: StockPriceUpdateData[]): Promise<void> {
    try {
      // Group by marketplace
      const groupedUpdates = updates.reduce((acc, update) => {
        if (!acc[update.marketplace]) {
          acc[update.marketplace] = [];
        }
        acc[update.marketplace].push(update);
        return acc;
      }, {} as Record<MarketplaceProvider, StockPriceUpdateData[]>);

      // Process each marketplace
      for (const [marketplace, marketplaceUpdates] of Object.entries(groupedUpdates)) {
        await this.updateStockAndPriceForMarketplace(tenantId, marketplace as MarketplaceProvider, marketplaceUpdates);
      }
    } catch (error) {
      throw new Error(`Failed to update stock and price: ${error.message}`);
    }
  }

  private async updateStockAndPriceForMarketplace(
    tenantId: string, 
    marketplace: MarketplaceProvider, 
    updates: StockPriceUpdateData[]
  ): Promise<void> {
    const account = await this.getMarketplaceAccount(tenantId, marketplace);
    if (!account) {
      throw new Error('Marketplace account not found');
    }

    switch (marketplace) {
      case 'TRENDYOL':
        await this.updateTrendyolStockAndPrice(account, updates);
        break;
      
      default:
        throw new Error(`Unsupported provider: ${marketplace}`);
    }
  }

  private async updateTrendyolStockAndPrice(account: any, updates: StockPriceUpdateData[]): Promise<void> {
    const credentials = this.decryptCredentials(account);
    const client = new TrendyolClient(credentials);

    // Get product SKUs
    const productIds = updates.map(u => u.productId);
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        tenantId: account.tenantId,
      },
      select: {
        id: true,
        sku: true,
      },
    });

    const trendyolUpdates = updates.map(update => {
      const product = products.find(p => p.id === update.productId);
      return {
        barcode: product?.sku || `SKU-${update.productId}`,
        quantity: update.quantity,
        price: update.price,
      };
    });

    await client.updateStockAndPrice(trendyolUpdates);

    // Create sync logs
    for (const update of updates) {
      await this.createSyncLog(account.tenantId, 'TRENDYOL', SyncType.STOCK, {
        status: MarketplaceSyncStatus.COMPLETED,
        entityId: update.productId,
      });
    }
  }

  // ORDER IMPORT
  async importOrders(tenantId: string, marketplace: MarketplaceProvider): Promise<any[]> {
    try {
      const account = await this.getMarketplaceAccount(tenantId, marketplace);
      if (!account) {
        throw new Error('Marketplace account not found');
      }

      let orders;
      
      switch (marketplace) {
        case 'TRENDYOL':
          orders = await this.importTrendyolOrders(account);
          break;
        
        default:
          throw new Error(`Unsupported provider: ${marketplace}`);
      }

      return orders;
    } catch (error) {
      throw new Error(`Failed to import orders: ${error.message}`);
    }
  }

  private async importTrendyolOrders(account: any): Promise<any[]> {
    const credentials = this.decryptCredentials(account);
    const client = new TrendyolClient(credentials);

    const response = await client.getOrders(0, 50); // Get last 50 orders
    const importedOrders = [];

    for (const order of response.content) {
      // Check if already imported
      const existingOrder = await this.prisma.marketplaceOrder.findFirst({
        where: {
          tenantId: account.tenantId,
          marketplace: 'TRENDYOL',
          externalId: order.id,
        },
      });

      if (!existingOrder) {
        // Create new order
        const newOrder = await this.prisma.marketplaceOrder.create({
          data: {
            tenantId: account.tenantId,
            externalId: order.id,
            marketplace: 'TRENDYOL',
            status: order.status,
            customerEmail: order.customerEmail,
            customerName: order.customerName,
            totalAmount: order.totalAmount,
            currency: order.currency,
            rawData: order,
          },
        });

        importedOrders.push(newOrder);

        // Create sync log
        await this.createSyncLog(account.tenantId, 'TRENDYOL', SyncType.ORDER, {
          status: MarketplaceSyncStatus.COMPLETED,
          entityId: newOrder.id,
          externalId: order.id,
        });
      }
    }

    // Update last sync time
    await this.prisma.marketplaceAccount.update({
      where: { id: account.id },
      data: { lastSyncAt: new Date() },
    });

    return importedOrders;
  }

  // CATEGORY & ATTRIBUTE CACHING
  async cacheCategories(marketplace: MarketplaceProvider): Promise<void> {
    try {
      let categories;
      
      switch (marketplace) {
        case 'TRENDYOL':
          categories = await this.cacheTrendyolCategories();
          break;
        
        default:
          throw new Error(`Unsupported provider: ${marketplace}`);
      }
    } catch (error) {
      throw new Error(`Failed to cache categories: ${error.message}`);
    }
  }

  private async cacheTrendyolCategories(): Promise<void> {
    // This would be implemented with a system account or during tenant setup
    // For now, we'll skip implementation
    console.log('Trendyol categories caching not implemented yet');
  }

  // HELPER METHODS
  private async getMarketplaceAccount(tenantId: string, provider: MarketplaceProvider): Promise<any> {
    return await this.prisma.marketplaceAccount.findFirst({
      where: {
        tenantId,
        provider,
        isActive: true,
      },
    });
  }

  private decryptCredentials(account: any): TrendyolCredentials {
    return {
      apiKey: this.decrypt(account.apiKey),
      apiSecret: this.decrypt(account.apiSecret),
      sellerId: account.sellerId,
    };
  }

  private encrypt(text: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(process.env.MARKETPLACE_ENCRYPTION_KEY || 'default-key', 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(encryptedText: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(process.env.MARKETPLACE_ENCRYPTION_KEY || 'default-key', 'salt', 32);
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private mapProductAttributes(product: any): Record<string, any> {
    // Map product custom fields to marketplace attributes
    const attributes: Record<string, any> = {};
    
    if (product.customFields) {
      const customFields = typeof product.customFields === 'string' 
        ? JSON.parse(product.customFields) 
        : product.customFields;
      
      Object.entries(customFields).forEach(([key, value]) => {
        attributes[key] = value;
      });
    }

    return attributes;
  }

  private mapVariantAttributes(variant: any): Record<string, any> {
    const attributes: Record<string, any> = {};
    
    if (variant.combination) {
      const combination = typeof variant.combination === 'string' 
        ? JSON.parse(variant.combination) 
        : variant.combination;
      
      Object.entries(combination).forEach(([key, value]) => {
        attributes[key] = value;
      });
    }

    return attributes;
  }

  private async updateProductMap(tenantId: string, productId: string, marketplace: MarketplaceProvider, externalId: string): Promise<void> {
    await this.prisma.marketplaceProductMap.upsert({
      where: {
        tenantId_marketplace_externalId: {
          tenantId,
          marketplace,
          externalId,
        },
      },
      update: {
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      },
      create: {
        tenantId,
        productId,
        marketplace,
        externalId,
        lastSyncAt: new Date(),
      },
    });
  }

  private async createSyncLog(
    tenantId: string, 
    marketplace: MarketplaceProvider, 
    syncType: SyncType, 
    data: {
      status: MarketplaceSyncStatus;
      entityId?: string;
      externalId?: string;
      errorMessage?: string;
      rawData?: any;
    }
  ): Promise<void> {
    await this.prisma.marketplaceSyncLog.create({
      data: {
        tenantId,
        marketplace,
        syncType,
        status: data.status,
        entityId: data.entityId,
        externalId: data.externalId,
        errorMessage: data.errorMessage,
        rawData: data.rawData,
      },
    });
  }
}
