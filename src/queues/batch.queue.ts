import { Job } from 'bullmq';
import { createQueue, createWorker, QUEUE_NAMES } from '../config/queue';
import { logger } from '../config/logger';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type BatchJobType = 
  | 'bulk-email'
  | 'bulk-export'
  | 'bulk-update'
  | 'bulk-delete'
  | 'bulk-import';

export interface BatchJobData {
  type: BatchJobType;
  tenantId: string;
  userId: string;
  items: any[];
  options?: any;
}

export interface BatchProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ item: any; error: string }>;
}

// Create batch queue
export const batchQueue = createQueue('batch-queue');

// Batch processor
async function processBatchJob(job: Job<BatchJobData>): Promise<BatchProgress> {
  const { type, tenantId, userId, items, options } = job.data;

  logger.info('[BatchQueue] Processing batch job', {
    jobId: job.id,
    type,
    tenantId,
    itemCount: items.length,
  });

  const progress: BatchProgress = {
    total: items.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      try {
        // Process based on type
        await processBatchItem(type, item, tenantId, options);
        
        progress.succeeded++;
      } catch (error: any) {
        progress.failed++;
        progress.errors.push({
          item,
          error: error.message,
        });

        logger.error('[BatchQueue] Item processing failed', {
          jobId: job.id,
          type,
          item,
          error: error.message,
        });
      }

      progress.processed++;

      // Update progress
      const percentage = Math.floor((progress.processed / progress.total) * 100);
      await job.updateProgress(percentage);

      // Log progress every 10%
      if (percentage % 10 === 0) {
        logger.info('[BatchQueue] Batch progress', {
          jobId: job.id,
          type,
          progress: `${progress.processed}/${progress.total}`,
          percentage: `${percentage}%`,
        });
      }
    }

    logger.info('[BatchQueue] Batch job completed', {
      jobId: job.id,
      type,
      total: progress.total,
      succeeded: progress.succeeded,
      failed: progress.failed,
    });

    return progress;
  } catch (error) {
    logger.error('[BatchQueue] Batch job failed', {
      error,
      jobId: job.id,
      type,
    });
    throw error;
  }
}

/**
 * Process individual batch item
 */
async function processBatchItem(
  type: BatchJobType,
  item: any,
  tenantId: string,
  options?: any
): Promise<void> {
  switch (type) {
    case 'bulk-email':
      await processBulkEmail(item, tenantId, options);
      break;

    case 'bulk-export':
      await processBulkExport(item, tenantId, options);
      break;

    case 'bulk-update':
      await processBulkUpdate(item, tenantId, options);
      break;

    case 'bulk-delete':
      await processBulkDelete(item, tenantId, options);
      break;

    case 'bulk-import':
      await processBulkImport(item, tenantId, options);
      break;

    default:
      throw new Error(`Unknown batch type: ${type}`);
  }
}

/**
 * Bulk email processing
 */
async function processBulkEmail(item: any, tenantId: string, options?: any): Promise<void> {
  // TODO: Implement email sending
  logger.debug('[BatchQueue] Processing bulk email', { item });
  
  // Simulate email sending
  await new Promise(resolve => setTimeout(resolve, 100));
}

/**
 * Bulk export processing
 */
async function processBulkExport(item: any, tenantId: string, options?: any): Promise<void> {
  logger.debug('[BatchQueue] Processing bulk export', { item });
  
  // Export logic here
  await new Promise(resolve => setTimeout(resolve, 50));
}

/**
 * Bulk update processing
 */
async function processBulkUpdate(item: any, tenantId: string, options?: any): Promise<void> {
  const { model, id, data } = item;

  logger.debug('[BatchQueue] Processing bulk update', { model, id });

  // Dynamic model update
  if (model === 'product') {
    await prisma.product.update({
      where: { id, tenantId },
      data,
    });
  } else if (model === 'order') {
    await prisma.order.update({
      where: { id, tenantId },
      data,
    });
  }
  // Add more models as needed
}

/**
 * Bulk delete processing
 */
async function processBulkDelete(item: any, tenantId: string, options?: any): Promise<void> {
  const { model, id } = item;

  logger.debug('[BatchQueue] Processing bulk delete', { model, id });

  // Dynamic model delete
  if (model === 'product') {
    await prisma.product.delete({
      where: { id, tenantId },
    });
  } else if (model === 'order') {
    await prisma.order.delete({
      where: { id, tenantId },
    });
  }
}

/**
 * Bulk import processing
 */
async function processBulkImport(item: any, tenantId: string, options?: any): Promise<void> {
  const { model, data } = item;

  logger.debug('[BatchQueue] Processing bulk import', { model });

  // Dynamic model create
  if (model === 'product') {
    await prisma.product.create({
      data: {
        ...data,
        tenantId,
      },
    });
  } else if (model === 'customer') {
    await prisma.customer.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }
}

// Create batch worker
export const batchWorker = createWorker(
  'batch-queue',
  processBatchJob,
  2 // 2 concurrent batch jobs
);

/**
 * Add batch job to queue
 */
export async function addBatchJob(data: BatchJobData): Promise<string> {
  const job = await batchQueue.add('batch-process', data, {
    priority: 3, // Lower priority than regular jobs
  });

  logger.info('[BatchQueue] Batch job added', {
    jobId: job.id,
    type: data.type,
    itemCount: data.items.length,
  });

  return job.id!;
}

/**
 * Get batch job status
 */
export async function getBatchJobStatus(jobId: string): Promise<{
  status: string;
  progress: number;
  result?: BatchProgress;
}> {
  const job = await batchQueue.getJob(jobId);

  if (!job) {
    throw new Error('Batch job not found');
  }

  const state = await job.getState();
  const progress = job.progress as number;

  let result: BatchProgress | undefined;
  if (state === 'completed') {
    result = await job.returnvalue;
  }

  return {
    status: state,
    progress,
    result,
  };
}
