import { Job } from 'bullmq';
import { createQueue, createWorker, QUEUE_NAMES } from '../config/queue';
import { ImageOptimizationService } from '../services/image-optimization.service';
import { logger } from '../config/logger';

export interface ImageProcessingJobData {
  inputPath: string;
  outputDir: string;
  filename: string;
  category: string;
}

// Create image processing queue
export const imageProcessingQueue = createQueue(QUEUE_NAMES.IMAGE_PROCESSING);

// Image processing processor
async function processImageJob(job: Job<ImageProcessingJobData>): Promise<any> {
  const { inputPath, outputDir, filename, category } = job.data;

  logger.info('[ImageProcessingQueue] Processing image job', {
    jobId: job.id,
    filename,
    category,
  });

  try {
    // Update progress
    await job.updateProgress(10);

    // Optimize image
    const result = await ImageOptimizationService.optimizeImage(
      inputPath,
      outputDir,
      filename
    );

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

// Create image processing worker
export const imageProcessingWorker = createWorker(
  QUEUE_NAMES.IMAGE_PROCESSING,
  processImageJob,
  3 // 3 concurrent jobs (CPU intensive)
);

/**
 * Process image asynchronously
 */
export async function processImageAsync(data: ImageProcessingJobData): Promise<void> {
  await imageProcessingQueue.add('process-image', data, {
    priority: 2,
  });

  logger.info('[ImageProcessingQueue] Image processing job added', {
    filename: data.filename,
    category: data.category,
  });
}
