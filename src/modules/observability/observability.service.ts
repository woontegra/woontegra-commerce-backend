import prisma from '../../config/database';
import { syncXmlSource } from '../xml-sources/xml-source.service';
import type { BusinessEventName } from '../../common/logging/business-events';

export interface LogQuery {
  tenantId:  string;
  page?:     number;
  limit?:    number;
  module?:   string;
  level?:    string;
  traceId?:  string;
  search?:   string;
  event?:    string;
}

export interface PaginatedLogs<T> {
  items:      T[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

function paginate(page: number, limit: number) {
  const p = Math.max(1, page);
  const l = Math.min(100, Math.max(1, limit));
  return { skip: (p - 1) * l, take: l, page: p, limit: l };
}

export async function queryPlatformLogs(q: LogQuery): Promise<PaginatedLogs<any>> {
  const { skip, take, page, limit } = paginate(q.page ?? 1, q.limit ?? 30);

  const where: Record<string, unknown> = {
    tenantId: q.tenantId,
    ...(q.module ? { module: q.module } : {}),
    ...(q.level ? { level: q.level } : {}),
    ...(q.traceId ? { traceId: q.traceId } : {}),
    ...(q.event ? { event: q.event } : {}),
    ...(q.search
      ? {
          OR: [
            { message:      { contains: q.search, mode: 'insensitive' } },
            { action:       { contains: q.search, mode: 'insensitive' } },
            { errorMessage: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.platformLogEntry.findMany({
      where:   where as any,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.platformLogEntry.count({ where: where as any }),
  ]);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function queryErrorAlerts(tenantId: string, page = 1, limit = 20) {
  const { skip, take, page: p, limit: l } = paginate(page, limit);

  const where = { tenantId, level: 'error' };

  const [items, total] = await Promise.all([
    prisma.platformLogEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.platformLogEntry.count({ where }),
  ]);

  return {
    items: items.map(row => ({
      ...row,
      retry: inferRetryAction(row),
    })),
    total,
    page:       p,
    limit:      l,
    totalPages: Math.max(1, Math.ceil(total / l)),
  };
}

function inferRetryAction(row: {
  module: string;
  action: string;
  metadata: unknown;
}): { type: string; label: string; payload: Record<string, string> } | null {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;

  if (row.module === 'xml' && (row.action === 'sync' || row.action === 'cron_sync')) {
    const sourceId = meta.sourceId != null ? String(meta.sourceId) : null;
    if (sourceId) {
      return { type: 'xml_sync', label: 'XML sync tekrar dene', payload: { sourceId } };
    }
  }

  if (row.module === 'trendyol' && row.action === 'send_products') {
    return { type: 'trendyol_resend', label: 'Trendyol gönderim sayfasına git', payload: {} };
  }

  return null;
}

const BUSINESS_EVENTS: BusinessEventName[] = [
  'product_sent',
  'xml_sync',
  'payment_success',
  'subscription_activated',
];

export async function getBusinessMetrics(tenantId: string, days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await prisma.platformLogEntry.groupBy({
    by:    ['event'],
    where: {
      tenantId,
      event:     { in: BUSINESS_EVENTS },
      createdAt: { gte: since },
    },
    _count: { event: true },
  });

  const counts: Record<string, number> = {
    product_sent:           0,
    xml_sync:               0,
    payment_success:        0,
    subscription_activated: 0,
  };

  for (const r of rows) {
    if (r.event && r.event in counts) counts[r.event] = r._count.event;
  }

  const daily = await prisma.platformLogEntry.findMany({
    where: {
      tenantId,
      event:     { in: BUSINESS_EVENTS },
      createdAt: { gte: since },
    },
    select: { event: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const byDay: Record<string, Record<string, number>> = {};
  for (const row of daily) {
    if (!row.event) continue;
    const day = row.createdAt.toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = {};
    byDay[day][row.event] = (byDay[day][row.event] ?? 0) + 1;
  }

  return { periodDays: days, counts, byDay };
}

export async function executeRetryAction(
  tenantId: string,
  userId: string,
  type: string,
  payload: Record<string, string>,
): Promise<{ ok: boolean; message: string }> {
  if (type === 'xml_sync') {
    const sourceId = payload.sourceId;
    if (!sourceId) return { ok: false, message: 'sourceId gerekli' };
    await syncXmlSource(sourceId, tenantId, userId);
    return { ok: true, message: 'XML senkron başlatıldı' };
  }

  if (type === 'trendyol_resend') {
    return { ok: true, message: 'Trendyol entegrasyon sayfasından ürün gönderimini tekrarlayın.' };
  }

  return { ok: false, message: 'Desteklenmeyen retry tipi' };
}
