import { Job, Queue, Worker } from 'bullmq';
import { createQueue, createWorker, isRedisConfigured, QUEUE_NAMES } from '../config/queue';
import { logger } from '../config/logger';
import { deliverEmail } from '../modules/email/email.provider';
import { renderEmailTemplate, type TemplateKey } from '../modules/email/templates';

const EMAIL_JOB_ATTEMPTS = parseInt(process.env.EMAIL_QUEUE_ATTEMPTS || '5', 10);
const EMAIL_JOB_BACKOFF_MS = parseInt(process.env.EMAIL_QUEUE_BACKOFF_MS || '3000', 10);

export interface EmailJobData {
  to: string;
  template?: TemplateKey;
  templateData?: Record<string, unknown>;
  subject?: string;
  html?: string;
  text?: string;
  from?: string;
  attachments?: Array<{
    filename: string;
    path: string;
  }>;
}

let emailQueueInstance: Queue | undefined;
let emailWorkerInstance: Worker | undefined;

function resolvePayload(data: EmailJobData): { to: string; subject: string; html: string; text?: string; from?: string } {
  if (data.template) {
    const rendered = renderEmailTemplate(data.template, data.templateData ?? {});
    return {
      to: data.to,
      subject: rendered.subject,
      html: rendered.html,
      text: data.text,
      from: data.from,
    };
  }

  if (!data.subject || !data.html) {
    throw new Error('E-posta işi: template veya subject+html zorunludur.');
  }

  return {
    to: data.to,
    subject: data.subject,
    html: data.html,
    text: data.text,
    from: data.from,
  };
}

async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const resolved = resolvePayload(job.data);

  logger.info('[EmailQueue] Processing', {
    jobId: job.id,
    attempt: job.attemptsMade + 1,
    to: resolved.to,
    subject: resolved.subject,
    template: job.data.template,
  });

  if (job.data.attachments?.length) {
    logger.warn({ message: '[EmailQueue] Attachments not yet supported in provider', jobId: job.id });
  }

  await deliverEmail(resolved);
}

export function initEmailQueue(): void {
  if (emailQueueInstance) return;
  emailQueueInstance = createQueue(QUEUE_NAMES.EMAIL);
  emailWorkerInstance = createWorker(QUEUE_NAMES.EMAIL, processEmailJob, 5);
}

export function getEmailQueue(): Queue {
  initEmailQueue();
  return emailQueueInstance!;
}

export function getEmailWorker(): Worker {
  initEmailQueue();
  return emailWorkerInstance!;
}

const defaultJobOpts = {
  attempts: EMAIL_JOB_ATTEMPTS,
  backoff: {
    type: 'exponential' as const,
    delay: EMAIL_JOB_BACKOFF_MS,
  },
  removeOnComplete: { count: 200, age: 24 * 3600 },
  removeOnFail: { count: 500, age: 7 * 24 * 3600 },
};

export async function sendEmailAsync(data: EmailJobData): Promise<string | undefined> {
  if (!isRedisConfigured()) {
    logger.warn('[EmailQueue] REDIS_URL yok — e-posta kuyruğa alınamadı', { to: data.to });
    return undefined;
  }

  const job = await getEmailQueue().add('send-email', data, {
    priority: 1,
    ...defaultJobOpts,
  });

  logger.info('[EmailQueue] Job queued', {
    jobId: job.id,
    to: data.to,
    template: data.template,
    subject: data.subject,
  });

  return job.id;
}

export async function sendBulkEmailsAsync(emails: EmailJobData[]): Promise<void> {
  if (!isRedisConfigured()) {
    logger.warn('[EmailQueue] REDIS_URL yok — toplu e-posta kuyruğa alınamadı', { count: emails.length });
    return;
  }

  const jobs = emails.map((email) => ({
    name: 'send-email',
    data: email,
    opts: { priority: 2, ...defaultJobOpts },
  }));

  await getEmailQueue().addBulk(jobs);
  logger.info('[EmailQueue] Bulk jobs queued', { count: emails.length });
}

export async function queuePasswordResetEmail(
  to: string,
  data: { resetUrl: string; userName?: string; expiresInMinutes?: number },
) {
  return sendEmailAsync({
    to,
    template: 'PASSWORD_RESET',
    templateData: data,
  });
}

export async function queueSubscriptionEmail(to: string, data: Record<string, unknown>) {
  return sendEmailAsync({
    to,
    template: 'SUBSCRIPTION_NOTIFICATION',
    templateData: data,
  });
}

export async function queueErrorAlertEmail(to: string, data: Record<string, unknown>) {
  return sendEmailAsync({
    to,
    template: 'ERROR_ALERT',
    templateData: data,
  });
}
