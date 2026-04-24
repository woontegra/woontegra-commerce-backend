import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { PrismaClient, MarketplaceProvider, SyncType, MarketplaceSyncStatus } from '@prisma/client';
import { MarketplaceService } from '../marketplace/marketplace.service';
import Redis from 'ioredis';

export interface QueueJobData {
  tenantId: string;
  marketplace: MarketplaceProvider;
  syncType: SyncType;
  data: any;
  retryCount?: number;
}

export class MarketplaceQueueService {
  private connection: Redis;
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();
  private marketplaceService: MarketplaceService;

  constructor(private prisma: PrismaClient) {
    this.connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.marketplaceService = new MarketplaceService(prisma);
    this.setupQueues();
  }

  private setupQueues(): void {
    // Product Export Queue
    this.setupQueue('product-export', this.processProductExport.bind(this));

    // Stock & Price Sync Queue
    this.setupQueue('stock-price-sync', this.processStockPriceSync.bind(this));

    // Order Import Queue
    this.setupQueue('order-import', this.processOrderImport.bind(this));

    // Status Sync Queue
    this.setupQueue('status-sync', this.processStatusSync.bind(this));

    // Category Cache Queue
    this.setupQueue('category-cache', this.processCategoryCache.bind(this));
  }

  private setupQueue(name: string, processor: (job: Job<QueueJobData>) => Promise<void>): void {
    const queue = new Queue(name, { connection: this.connection });
    const worker = new Worker(name, processor, { 
      connection: this.connection,
      concurrency: 5, // Process 5 jobs concurrently
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 50, // Keep last 50 failed jobs
    });

    const queueEvents = new QueueEvents(name, { connection: this.connection });

    // Event listeners
    queueEvents.on('completed', ({ jobId, returnvalue }) => {
      console.log(`Job ${jobId} in queue ${name} completed:`, returnvalue);
    });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`Job ${jobId} in queue ${name} failed:`, failedReason);
    });

    queueEvents.on('progress', ({ jobId, data }) => {
      console.log(`Job ${jobId} in queue ${name} progress:`, data);
    });

    this.queues.set(name, queue);
    this.workers.set(name, worker);
    this.queueEvents.set(name, queueEvents);
  }

  // QUEUE MANAGEMENT METHODS
  async addJob(queueName: string, data: QueueJobData, options?: any): Promise<Job> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const job = await queue.add(
      `${data.syncType}-${data.marketplace}-${data.tenantId}`,
      data,
      {
        attempts: 3, // Retry 3 times
        backoff: {
          type: 'exponential',
          delay: 2000, // Start with 2 seconds delay
        },
        removeOnComplete: 100,
        removeOnFail: 50,
        ...options,
      }
    );

    // Create sync log
    await this.createSyncLog(data.tenantId, data.marketplace, data.syncType, {
      status: MarketplaceSyncStatus.PENDING,
      entityId: data.data.productId || data.data.orderId,
      externalId: data.data.externalId,
    });

    return job;
  }

  async getQueueStatus(queueName: string): Promise<any> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
    };
  }

  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    await queue.pause();
  }

  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    await queue.resume();
  }

  // JOB PROCESSORS
  private async processProductExport(job: Job<QueueJobData>): Promise<void> {
    const { tenantId, marketplace, data } = job.data;
    
    try {
      await job.updateProgress(10);
      
      const result = await this.marketplaceService.exportProduct(tenantId, {
        productId: data.productId,
        marketplace,
        categoryId: data.categoryId,
        brandId: data.brandId,
      });

      await job.updateProgress(100);

      // Update sync log
      await this.updateSyncLog(tenantId, marketplace, SyncType.PRODUCT, {
        status: MarketplaceSyncStatus.COMPLETED,
        entityId: data.productId,
        externalId: result.externalId,
      });

      console.log(`Product ${data.productId} exported to ${marketplace} successfully`);
    } catch (error) {
      // Update sync log with error
      await this.updateSyncLog(tenantId, marketplace, SyncType.PRODUCT, {
        status: MarketplaceSyncStatus.FAILED,
        entityId: data.productId,
        errorMessage: error.message,
        retryCount: job.opts.attempts ? (job.opts.attempts - job.data.retryCount || 0) : 0,
      });

      throw error;
    }
  }

  private async processStockPriceSync(job: Job<QueueJobData>): Promise<void> {
    const { tenantId, marketplace, data } = job.data;
    
    try {
      await job.updateProgress(10);

      await this.marketplaceService.updateStockAndPrice(tenantId, data.updates);
      
      await job.updateProgress(100);

      // Update sync logs
      for (const update of data.updates) {
        await this.updateSyncLog(tenantId, marketplace, SyncType.STOCK, {
          status: MarketplaceSyncStatus.COMPLETED,
          entityId: update.productId,
        });
      }

      console.log(`Stock & price sync completed for ${data.updates.length} products`);
    } catch (error) {
      // Update sync logs with error
      for (const update of data.updates) {
        await this.updateSyncLog(tenantId, marketplace, SyncType.STOCK, {
          status: MarketplaceSyncStatus.FAILED,
          entityId: update.productId,
          errorMessage: error.message,
        });
      }

      throw error;
    }
  }

  private async processOrderImport(job: Job<QueueJobData>): Promise<void> {
    const { tenantId, marketplace } = job.data;
    
    try {
      await job.updateProgress(10);

      const orders = await this.marketplaceService.importOrders(tenantId, marketplace);
      
      await job.updateProgress(100);

      // Update sync log
      await this.updateSyncLog(tenantId, marketplace, SyncType.ORDER, {
        status: MarketplaceSyncStatus.COMPLETED,
        rawData: { importedCount: orders.length },
      });

      console.log(`Imported ${orders.length} orders from ${marketplace}`);
    } catch (error) {
      // Update sync log with error
      await this.updateSyncLog(tenantId, marketplace, SyncType.ORDER, {
        status: MarketplaceSyncStatus.FAILED,
        errorMessage: error.message,
      });

      throw error;
    }
  }

  private async processStatusSync(job: Job<QueueJobData>): Promise<void> {
    const { tenantId, marketplace, data } = job.data;
    
    try {
      await job.updateProgress(10);

      // This would sync order status from internal system to marketplace
      // Implementation depends on specific requirements
      
      await job.updateProgress(100);

      console.log(`Status sync completed for order ${data.orderId}`);
    } catch (error) {
      throw error;
    }
  }

  private async processCategoryCache(job: Job<QueueJobData>): Promise<void> {
    const { marketplace } = job.data;
    
    try {
      await job.updateProgress(10);

      await this.marketplaceService.cacheCategories(marketplace);
      
      await job.updateProgress(100);

      console.log(`Categories cached for ${marketplace}`);
    } catch (error) {
      throw error;
    }
  }

  // SCHEDULED JOBS
  async setupScheduledJobs(): void {
    // Order import every 5 minutes
    setInterval(async () => {
      try {
        const accounts = await this.prisma.marketplaceAccount.findMany({
          where: { isActive: true },
          select: { tenantId: true, provider: true },
        });

        for (const account of accounts) {
          await this.addJob('order-import', {
            tenantId: account.tenantId,
            marketplace: account.provider,
            syncType: SyncType.ORDER,
            data: {},
          });
        }
      } catch (error) {
        console.error('Scheduled order import failed:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes

    // Category cache every 24 hours
    setInterval(async () => {
      try {
        for (const provider of Object.values(MarketplaceProvider)) {
          await this.addJob('category-cache', {
            tenantId: 'system', // System-level job
            marketplace: provider,
            syncType: SyncType.PRODUCT, // Using PRODUCT as sync type for categories
            data: {},
          });
        }
      } catch (error) {
        console.error('Scheduled category cache failed:', error);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours
  }

  // HELPER METHODS
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

  private async updateSyncLog(
    tenantId: string,
    marketplace: MarketplaceProvider,
    syncType: SyncType,
    data: {
      status: MarketplaceSyncStatus;
      entityId?: string;
      externalId?: string;
      errorMessage?: string;
      rawData?: any;
      retryCount?: number;
    }
  ): Promise<void> {
    await this.prisma.marketplaceSyncLog.updateMany({
      where: {
        tenantId,
        marketplace,
        syncType,
        entityId: data.entityId,
      },
      data: {
        status: data.status,
        externalId: data.externalId,
        errorMessage: data.errorMessage,
        rawData: data.rawData,
        retryCount: data.retryCount,
      },
    });
  }

  // CLEANUP
  async close(): Promise<void> {
    // Close all workers and queues
    for (const [name, worker] of this.workers) {
      await worker.close();
      console.log(`Worker for queue ${name} closed`);
    }

    for (const [name, queue] of this.queues) {
      await queue.close();
      console.log(`Queue ${name} closed`);
    }

    for (const [name, queueEvents] of this.queueEvents) {
      await queueEvents.close();
      console.log(`Queue events for ${name} closed`);
    }

    await this.connection.quit();
    console.log('Redis connection closed');
  }
}
