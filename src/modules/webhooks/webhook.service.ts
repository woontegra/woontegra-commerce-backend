import crypto  from 'crypto';
import https   from 'https';
import http    from 'http';
import prisma  from '../../config/database';
import { logger } from '../../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export const WEBHOOK_EVENTS = [
  'order.created',
  'order.updated',
  'order.deleted',
  'payment.success',
  'payment.failed',
  'subscription.activated',
  'subscription.canceled',
  'product.created',
  'product.updated',
  'product.deleted',
  'customer.created',
  'customer.updated',
  'trial.ending_soon',
  'trial.expired',
  'tenant.suspended',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookPayload {
  id:        string;         // unique delivery ID
  event:     WebhookEvent;
  timestamp: string;         // ISO8601
  tenantId:  string;
  data:      Record<string, unknown>;
}

// ─── HMAC signature ───────────────────────────────────────────────────────────

export function signPayload(secret: string, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function verifySignature(secret: string, body: string, sig: string): boolean {
  const expected = signPayload(secret, body);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

export function generateWebhookSecret(): string {
  return crypto.randomBytes(24).toString('hex');
}

// ─── HTTP delivery ────────────────────────────────────────────────────────────

const TIMEOUT_MS = 10_000;

async function httpPost(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port:     parsed.port || (isHttps ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers:  { ...headers, 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data.slice(0, 500) }));
      },
    );

    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Deliver single webhook ───────────────────────────────────────────────────

async function deliver(
  webhookId: string,
  secret:    string,
  url:       string,
  payload:   WebhookPayload,
  attempt:   number,
): Promise<boolean> {
  const body      = JSON.stringify(payload);
  const signature = signPayload(secret, body);

  let statusCode: number | undefined;
  let response:   string | undefined;
  let success = false;

  try {
    const result = await httpPost(url, {
      'Content-Type':      'application/json',
      'X-Woontegra-Event': payload.event,
      'X-Woontegra-Sig':   signature,
      'X-Delivery-Id':     payload.id,
      'User-Agent':        'Woontegra-Webhooks/1.0',
    }, body);

    statusCode = result.status;
    response   = result.body;
    success    = statusCode >= 200 && statusCode < 300;
  } catch (err: any) {
    response = err.message;
    success  = false;
  }

  // Exponential back-off: 1m, 5m, 30m, 2h, 8h
  const RETRY_DELAYS = [60, 300, 1800, 7200, 28800];
  const nextRetryAt = !success && attempt < RETRY_DELAYS.length
    ? new Date(Date.now() + RETRY_DELAYS[attempt - 1] * 1000)
    : null;

  await prisma.webhookLog.create({
    data: {
      webhookId,
      event:      payload.event,
      payload:    payload as any,
      statusCode: statusCode ?? null,
      response:   response ?? null,
      success,
      attempts:   attempt,
      nextRetryAt,
    },
  });

  if (!success) {
    logger.warn({ message: '[Webhook] Delivery failed', webhookId, url, attempt, statusCode });
  }

  return success;
}

// ─── Dispatch to all registered endpoints for an event ───────────────────────

export async function dispatchWebhook(
  tenantId: string,
  event:    WebhookEvent,
  data:     Record<string, unknown>,
): Promise<void> {
  const hooks = await prisma.webhook.findMany({
    where: {
      tenantId,
      isActive: true,
      events:   { has: event },
    },
  });

  if (!hooks.length) return;

  const payload: WebhookPayload = {
    id:        crypto.randomUUID(),
    event,
    timestamp: new Date().toISOString(),
    tenantId,
    data,
  };

  // Fire-and-forget — don't block the main request
  Promise.allSettled(
    hooks.map((h) => deliver(h.id, h.secret, h.url, payload, 1)),
  ).catch(() => {});
}

// ─── Retry pending failed deliveries (called by cron) ────────────────────────

export async function retryPendingWebhooks(): Promise<void> {
  const pending = await prisma.webhookLog.findMany({
    where: {
      success:    false,
      nextRetryAt: { lte: new Date() },
      attempts:   { lt: 5 },
    },
    include: { webhook: true },
    take: 100,
  });

  for (const log of pending) {
    if (!log.webhook.isActive) continue;
    const payload = log.payload as WebhookPayload;
    await deliver(log.webhookId, log.webhook.secret, log.webhook.url, payload, log.attempts + 1);

    // Mark old log so it's not picked up again
    await prisma.webhookLog.update({
      where: { id: log.id },
      data:  { nextRetryAt: null },
    });
  }
}

// ─── CRUD wrappers ────────────────────────────────────────────────────────────

export async function createWebhook(tenantId: string, data: {
  url: string; events: string[]; description?: string;
}) {
  return prisma.webhook.create({
    data: {
      tenantId,
      url:         data.url,
      events:      data.events,
      description: data.description,
      secret:      generateWebhookSecret(),
    },
  });
}

export async function listWebhooks(tenantId: string) {
  return prisma.webhook.findMany({
    where:   { tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, url: true, events: true, description: true,
      isActive: true, secret: true, createdAt: true,
      _count: { select: { logs: true } },
    },
  });
}

export async function getWebhook(id: string, tenantId: string) {
  return prisma.webhook.findFirst({
    where:   { id, tenantId },
    include: {
      logs: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
}

export async function updateWebhook(id: string, tenantId: string, data: {
  url?: string; events?: string[]; description?: string; isActive?: boolean;
}) {
  return prisma.webhook.updateMany({
    where: { id, tenantId },
    data,
  });
}

export async function rotateSecret(id: string, tenantId: string) {
  const wh = await prisma.webhook.findFirst({ where: { id, tenantId } });
  if (!wh) return null;
  return prisma.webhook.update({
    where: { id },
    data:  { secret: generateWebhookSecret() },
  });
}

export async function deleteWebhook(id: string, tenantId: string) {
  return prisma.webhook.deleteMany({ where: { id, tenantId } });
}

export async function testWebhook(id: string, tenantId: string) {
  const wh = await prisma.webhook.findFirst({ where: { id, tenantId } });
  if (!wh) return null;

  const payload: WebhookPayload = {
    id:        crypto.randomUUID(),
    event:     'order.created',
    timestamp: new Date().toISOString(),
    tenantId,
    data:      { test: true, message: 'This is a test webhook delivery.' },
  };

  const success = await deliver(wh.id, wh.secret, wh.url, payload, 1);
  return { success };
}

export async function getWebhookLogs(webhookId: string, tenantId: string, page = 1, limit = 20) {
  const webhook = await prisma.webhook.findFirst({ where: { id: webhookId, tenantId } });
  if (!webhook) return null;

  const [logs, total] = await Promise.all([
    prisma.webhookLog.findMany({
      where:   { webhookId },
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
    }),
    prisma.webhookLog.count({ where: { webhookId } }),
  ]);

  return { logs, total, page, totalPages: Math.ceil(total / limit) };
}
