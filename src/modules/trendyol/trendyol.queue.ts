/**
 * In-memory batch store for Trendyol bulk send operations.
 * Jobs live for 2 hours then auto-expire.
 */
import { randomUUID } from 'crypto';

export interface BatchResult {
  productId:   string;
  productName: string;
  status:      'pending' | 'sending' | 'success' | 'error' | 'skipped';
  message:     string;
  trendyolBatchId?: string;
}

export interface BatchJob {
  batchId:    string;
  tenantId:   string;
  total:      number;
  processed:  number;
  success:    number;
  failed:     number;
  skipped:    number;
  status:     'pending' | 'running' | 'done';
  results:    BatchResult[];
  startedAt:  Date;
  finishedAt?: Date;
  /** Trendyol-level rate limit: ms delay between each product send */
  delayMs:    number;
}

class TrendyolBatchStore {
  private store = new Map<string, BatchJob>();

  /** Create a new batch and return it. */
  create(tenantId: string, productIds: string[], delayMs = 1200): BatchJob {
    const batchId = randomUUID();
    const job: BatchJob = {
      batchId,
      tenantId,
      total:     productIds.length,
      processed: 0,
      success:   0,
      failed:    0,
      skipped:   0,
      status:    'pending',
      results:   productIds.map(id => ({
        productId:   id,
        productName: '',
        status:      'pending',
        message:     'Sırada bekliyor…',
      })),
      startedAt: new Date(),
      delayMs,
    };
    this.store.set(batchId, job);
    // Auto-cleanup after 2 hours
    setTimeout(() => this.store.delete(batchId), 7_200_000);
    return job;
  }

  get(batchId: string): BatchJob | undefined {
    return this.store.get(batchId);
  }

  setRunning(batchId: string) {
    const job = this.store.get(batchId);
    if (job) job.status = 'running';
  }

  /** Mark a product as currently being sent */
  markSending(batchId: string, productId: string, productName: string) {
    const job = this.store.get(batchId);
    if (!job) return;
    const r = job.results.find(r => r.productId === productId);
    if (r) { r.status = 'sending'; r.productName = productName; r.message = 'Gönderiliyor…'; }
  }

  /** Update the result for one product and recalculate counters */
  updateResult(batchId: string, productId: string, result: Partial<BatchResult>) {
    const job = this.store.get(batchId);
    if (!job) return;
    const r = job.results.find(r => r.productId === productId);
    if (r) Object.assign(r, result);

    // Recalculate
    const done = job.results.filter(r => r.status !== 'pending' && r.status !== 'sending');
    job.processed = done.length;
    job.success   = job.results.filter(r => r.status === 'success').length;
    job.failed    = job.results.filter(r => r.status === 'error').length;
    job.skipped   = job.results.filter(r => r.status === 'skipped').length;

    if (job.processed >= job.total) {
      job.status     = 'done';
      job.finishedAt = new Date();
    }
  }
}

export const batchStore = new TrendyolBatchStore();

/** Utility: wait ms milliseconds */
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
