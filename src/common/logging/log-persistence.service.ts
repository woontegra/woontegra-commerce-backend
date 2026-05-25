import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';
import type { NormalizedLogRecord } from './normalize';

const RETENTION_DAYS = 30;

function toInputJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value
      .map(item => toInputJsonValue(item))
      .filter((item): item is Prisma.InputJsonValue => item !== undefined);
  }
  if (typeof value === 'object') {
    return toInputJsonObject(value as Record<string, unknown>);
  }

  return String(value);
}

function toInputJsonObject(record: Record<string, unknown>): Prisma.InputJsonObject {
  const entries = Object.entries(record).flatMap(([key, value]) => {
    const jsonValue = toInputJsonValue(value);
    return jsonValue === undefined ? [] : [[key, jsonValue] as const];
  });
  return Object.fromEntries(entries) as Prisma.InputJsonObject;
}

function buildMetadata(record: NormalizedLogRecord): Record<string, unknown> | undefined {
  if (record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)) {
    return record.metadata as Record<string, unknown>;
  }
  const skip = new Set([
    'timestamp', 'level', 'module', 'action', 'status', 'traceId',
    'tenantId', 'userId', 'message', 'stack', 'errorMessage', 'event', 'metadata',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (!skip.has(k) && v !== undefined && v !== null) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Winston kayıtlarını UI sorguları için PostgreSQL'e yazar (fire-and-forget). */
export async function persistPlatformLog(record: NormalizedLogRecord): Promise<void> {
  try {
    const metadata = buildMetadata(record);

    await prisma.platformLogEntry.create({
      data: {
        level:        record.level,
        module:       record.module,
        action:       record.action,
        status:       record.status ?? null,
        traceId:      record.traceId ?? null,
        tenantId:     record.tenantId ?? null,
        userId:       record.userId ?? null,
        message:      record.message?.slice(0, 2000) ?? record.action,
        errorMessage: typeof record.errorMessage === 'string' ? record.errorMessage.slice(0, 2000) : null,
        stack:        typeof record.stack === 'string' ? record.stack.slice(0, 8000) : null,
        event:        typeof record.event === 'string' ? record.event : null,
        metadata:     metadata === undefined ? undefined : toInputJsonObject(metadata),
      },
    });
  } catch {
    // Log persistence must never break the app
  }
}

/** Eski log satırlarını temizler (opsiyonel cron). */
export async function pruneOldPlatformLogs(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const r = await prisma.platformLogEntry.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return r.count;
}
