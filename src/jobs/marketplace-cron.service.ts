import cron from 'node-cron';
import { PrismaClient, MarketplaceProvider } from '@prisma/client';
import { MarketplaceQueueService } from './marketplace-queue.service';

export class MarketplaceCronService {
  private marketplaceQueueService: MarketplaceQueueService;

  constructor(private prisma: PrismaClient) {
    this.marketplaceQueueService = new MarketplaceQueueService(prisma);
  }

  start(): void {
    console.log('🚀 Starting marketplace cron jobs...');

    // Order import job - runs every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      await this.runOrderImport();
    }, {
      scheduled: true,
      timezone: 'Europe/Istanbul',
    });

    // Stock & price sync job - runs every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
      await this.runStockPriceSync();
    }, {
      scheduled: true,
      timezone: 'Europe/Istanbul',
    });

    // Category cache refresh - runs every day at 2 AM
    cron.schedule('0 2 * * *', async () => {
      await this.runCategoryCache();
    }, {
      scheduled: true,
      timezone: 'Europe/Istanbul',
    });

    // Cleanup old sync logs - runs every day at 3 AM
    cron.schedule('0 3 * * *', async () => {
      await this.cleanupOldLogs();
    }, {
      scheduled: true,
      timezone: 'Europe/Istanbul',
    });

    // Failed job retry - runs every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
      await this.retryFailedJobs();
    }, {
      scheduled: true,
      timezone: 'Europe/Istanbul',
    });

    console.log('✅ Marketplace cron jobs started successfully');
  }

  private async runOrderImport(): Promise<void> {
    console.log('📦 Starting scheduled order import...');
    
    try {
      // Get all active marketplace accounts
      const accounts = await this.prisma.marketplaceAccount.findMany({
        where: { 
          isActive: true,
        },
        select: {
          tenantId: true,
          provider: true,
          sellerId: true,
          lastSyncAt: true,
        },
      });

      console.log(`Found ${accounts.length} active marketplace accounts`);

      for (const account of accounts) {
        try {
          // Check if enough time has passed since last sync
          const now = new Date();
          const lastSync = account.lastSyncAt;
          const minInterval = 5 * 60 * 1000; // 5 minutes

          if (lastSync && (now.getTime() - lastSync.getTime() < minInterval)) {
            console.log(`Skipping order import for ${account.provider} - too soon since last sync`);
            continue;
          }

          // Add order import job to queue
          await this.marketplaceQueueService.addJob('order-import', {
            tenantId: account.tenantId,
            marketplace: account.provider,
            syncType: 'ORDER' as any,
            data: {},
          });

          console.log(`✅ Order import job queued for ${account.provider} (${account.tenantId})`);
        } catch (error) {
          console.error(`❌ Failed to queue order import for ${account.provider}:`, error.message);
        }
      }

      console.log('📦 Scheduled order import completed');
    } catch (error) {
      console.error('❌ Scheduled order import failed:', error);
    }
  }

  private async runStockPriceSync(): Promise<void> {
    console.log('🔄 Starting scheduled stock & price sync...');
    
    try {
      // Get all active product maps
      const productMaps = await this.prisma.marketplaceProductMap.findMany({
        where: { 
          isActive: true,
        },
        include: {
          product: {
            select: {
              id: true,
              price: true,
              sku: true,
            },
          },
        },
        distinct: ['tenantId', 'marketplace'],
      });

      // Group by tenant and marketplace
      const grouped = productMaps.reduce((acc, map) => {
        const key = `${map.tenantId}-${map.marketplace}`;
        if (!acc[key]) {
          acc[key] = {
            tenantId: map.tenantId,
            marketplace: map.marketplace,
            productIds: [],
          };
        }
        acc[key].productIds.push(map.productId);
        return acc;
      }, {} as Record<string, any>);

      console.log(`Found ${Object.keys(grouped).length} tenant-marketplace combinations`);

      for (const group of Object.values(grouped)) {
        try {
          // Get stock information for products
          const stocks = await this.prisma.stock.findMany({
            where: {
              productId: { in: group.productIds },
            },
          });

          // Get product maps for this group
          const maps = await this.prisma.marketplaceProductMap.findMany({
            where: {
              tenantId: group.tenantId,
              marketplace: group.marketplace,
              productId: { in: group.productIds },
              isActive: true,
            },
            include: {
              product: {
                select: {
                  id: true,
                  price: true,
                  sku: true,
                },
              },
            },
          });

          // Prepare updates
          const updates = maps.map(map => {
            const stock = stocks.find(s => s.productId === map.productId);
            return {
              productId: map.productId,
              marketplace: group.marketplace,
              quantity: stock?.quantity || 0,
              price: Number(map.product.price),
            };
          });

          if (updates.length > 0) {
            await this.marketplaceQueueService.addJob('stock-price-sync', {
              tenantId: group.tenantId,
              marketplace: group.marketplace,
              syncType: 'STOCK' as any,
              data: { updates },
            });

            console.log(`✅ Stock & price sync job queued for ${updates.length} products`);
          }
        } catch (error) {
          console.error(`❌ Failed to queue stock sync for ${group.marketplace}:`, error.message);
        }
      }

      console.log('🔄 Scheduled stock & price sync completed');
    } catch (error) {
      console.error('❌ Scheduled stock & price sync failed:', error);
    }
  }

  private async runCategoryCache(): Promise<void> {
    console.log('📂 Starting scheduled category cache refresh...');
    
    try {
      for (const provider of Object.values(MarketplaceProvider)) {
        try {
          await this.marketplaceQueueService.addJob('category-cache', {
            tenantId: 'system',
            marketplace: provider,
            syncType: 'PRODUCT' as any,
            data: {},
          });

          console.log(`✅ Category cache job queued for ${provider}`);
        } catch (error) {
          console.error(`❌ Failed to queue category cache for ${provider}:`, error.message);
        }
      }

      console.log('📂 Scheduled category cache refresh completed');
    } catch (error) {
      console.error('❌ Scheduled category cache refresh failed:', error);
    }
  }

  private async cleanupOldLogs(): Promise<void> {
    console.log('🧹 Starting scheduled cleanup of old sync logs...');
    
    try {
      // Delete logs older than 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const deletedCount = await this.prisma.marketplaceSyncLog.deleteMany({
        where: {
          createdAt: {
            lt: thirtyDaysAgo,
          },
        },
      });

      console.log(`🧹 Cleaned up ${deletedCount.count} old sync logs`);
    } catch (error) {
      console.error('❌ Failed to cleanup old logs:', error);
    }
  }

  private async retryFailedJobs(): Promise<void> {
    console.log('🔄 Starting scheduled retry of failed jobs...');
    
    try {
      // Get recent failed sync logs with retry count < 3
      const failedLogs = await this.prisma.marketplaceSyncLog.findMany({
        where: {
          status: 'FAILED',
          retryCount: {
            lt: 3,
          },
          createdAt: {
            gte: new Date(Date.now() - 60 * 60 * 1000), // Last hour
          },
        },
        include: {
          tenant: {
            select: {
              id: true,
            },
          },
        },
        take: 50, // Limit to prevent overwhelming the system
      });

      console.log(`Found ${failedLogs.length} failed jobs to retry`);

      for (const log of failedLogs) {
        try {
          // Increment retry count
          await this.prisma.marketplaceSyncLog.update({
            where: { id: log.id },
            data: {
              retryCount: log.retryCount + 1,
              status: 'RETRYING',
            },
          });

          // Re-queue the job based on sync type
          let queueName: string;
          let jobData: any;

          switch (log.syncType) {
            case 'PRODUCT':
              queueName = 'product-export';
              jobData = {
                productId: log.entityId,
                categoryId: log.rawData?.categoryId,
                brandId: log.rawData?.brandId,
              };
              break;
            
            case 'STOCK':
              queueName = 'stock-price-sync';
              jobData = {
                updates: log.rawData?.updates || [],
              };
              break;
            
            case 'ORDER':
              queueName = 'order-import';
              jobData = {};
              break;
            
            default:
              console.log(`⚠️ Unknown sync type for retry: ${log.syncType}`);
              continue;
          }

          await this.marketplaceQueueService.addJob(queueName, {
            tenantId: log.tenantId,
            marketplace: log.marketplace,
            syncType: log.syncType,
            data: jobData,
            retryCount: log.retryCount + 1,
          });

          console.log(`✅ Retried failed job: ${log.syncType} for ${log.marketplace}`);
        } catch (error) {
          console.error(`❌ Failed to retry job ${log.id}:`, error.message);
          
          // Mark as permanently failed
          await this.prisma.marketplaceSyncLog.update({
            where: { id: log.id },
            data: {
              status: 'FAILED',
              errorMessage: `Retry failed: ${error.message}`,
            },
          });
        }
      }

      console.log('🔄 Scheduled retry of failed jobs completed');
    } catch (error) {
      console.error('❌ Scheduled retry of failed jobs failed:', error);
    }
  }

  stop(): void {
    console.log('🛑 Stopping marketplace cron jobs...');
    cron.getTasks().forEach(task => task.stop());
    console.log('✅ Marketplace cron jobs stopped');
  }
}
