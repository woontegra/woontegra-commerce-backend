import { Job } from 'bullmq';
import { createQueue, createWorker, QUEUE_NAMES } from '../config/queue';
import { logger } from '../config/logger';

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  from?: string;
  attachments?: Array<{
    filename: string;
    path: string;
  }>;
}

// Create email queue
export const emailQueue = createQueue(QUEUE_NAMES.EMAIL);

// Email processor
async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { to, subject, html, from, attachments } = job.data;

  logger.info('[EmailQueue] Processing email job', {
    jobId: job.id,
    to,
    subject,
  });

  try {
    // TODO: Implement actual email sending (nodemailer, sendgrid, etc.)
    // For now, just log
    logger.info('[EmailQueue] Email sent (simulated)', {
      to,
      subject,
      hasAttachments: !!attachments?.length,
    });

    // Simulate email sending delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    return;
  } catch (error) {
    logger.error('[EmailQueue] Email sending failed', {
      error,
      to,
      subject,
    });
    throw error;
  }
}

// Create email worker
export const emailWorker = createWorker(
  QUEUE_NAMES.EMAIL,
  processEmailJob,
  5 // 5 concurrent jobs
);

/**
 * Add email to queue
 */
export async function sendEmailAsync(data: EmailJobData): Promise<void> {
  await emailQueue.add('send-email', data, {
    priority: 1,
  });

  logger.info('[EmailQueue] Email job added', {
    to: data.to,
    subject: data.subject,
  });
}

/**
 * Send bulk emails
 */
export async function sendBulkEmailsAsync(emails: EmailJobData[]): Promise<void> {
  const jobs = emails.map(email => ({
    name: 'send-email',
    data: email,
    opts: { priority: 2 },
  }));

  await emailQueue.addBulk(jobs);

  logger.info('[EmailQueue] Bulk email jobs added', {
    count: emails.length,
  });
}
