import { Job, Queue, Worker } from 'bullmq';
import { createQueue, createWorker, isRedisConfigured, QUEUE_NAMES } from '../config/queue';
import { ImageOptimizationService } from '../services/image-optimization.service';
import { logger } from '../config/logger';

export interface ImageProcessingJobData {
  inputPath: string;
  outputDir: string;
  filename: string;
  category: string;
}

let imageProcessingQueueInstance: Queue | undefined;
let imageProcessingWorkerInstance: Worker | undefined;

async function processImageJob(job: Job<ImageProcessingJobData>): Promise<any> {
  const { inputPath, outputDir, filename, category } = job.data;

  logger.info('[ImageProcessingQueue] Processing image job', {
    jobId: job.id,
    filename,
    category,
  });

  try {
    await job.updateProgress(10);

    const result = await ImageOptimizationService.optimizeImage(inputPath, outputDir, filename);

    await job.updateProgress(100);

    logger.info('[ImageProcessingQueue] Image processed', {
      filename,
      variants: Object.keys(result).length,
    });

    return result;
  } catch (error) {
    logger.error('[ImageProcessingQueue] Image processing failed', {
      error,
      filename,
    });
    throw error;
  }
}

export function initImageProcessingQueue(): void {
  if (imageProcessingQueueInstance) return;
  imageProcessingQueueInstance = createQueue(QUEUE_NAMES.IMAGE_PROCESSING);
  imageProcessingWorkerInstance = createWorker(
    QUEUE_NAMES.IMAGE_PROCESSING,
    processImageJob,
    3,
  );
}

export function getImageProcessingQueue(): Queue {
  initImageProcessingQueue();
  return imageProcessingQueueInstance!;
}

export function getImageProcessingWorker(): Worker {
  initImageProcessingQueue();
  return imageProcessingWorkerInstance!;
}

export async function processImageAsync(data: ImageProcessingJobData): Promise<void> {
  if (!isRedisConfigured()) {
    logger.warn('[ImageProcessingQueue] REDIS_URL yok — görsel işleme kuyruğa alınamadı', {
      filename: data.filename,
    });
    return;
  }

  await getImageProcessingQueue().add('process-image', data, { priority: 2 });

  logger.info('[ImageProcessingQueue] Image processing job added', {
    filename: data.filename,
    category: data.category,
  });
}
