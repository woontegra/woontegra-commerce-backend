import { UserRole } from '@prisma/client';
import prisma from '../../config/database';
import { logBusinessEvent } from '../../common/logging/business-events';
import { xmlLogger } from '../../common/logging/loggers';
import {
  buildFieldMapping,
  buildXmlUrlPreview,
  fetchUrlAsBuffer,
  runXmlUrlImportPipeline,
  type DuplicateMode,
  type XmlUrlImportPipelineResult,
} from '../products/xml-import.controller';
import {
  packStoredMapping,
  parseStoredMapping,
  type CustomTargetDef,
  type StoredXmlMapping,
} from './xml-source-mapping.utils';

type AutoSyncIntervalHours = 1 | 6 | 12;

export type { CustomTargetDef, StoredXmlMapping };

function asMapping(raw: unknown): Record<string, string> {
  return parseStoredMapping(raw).fields;
}

function clampInt(v: unknown, min: number, max: number): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return null;
  const nn = Math.floor(n);
  if (nn < min || nn > max) return null;
  return nn;
}

function normalizeTimezone(v: unknown): string {
  const tz = typeof v === 'string' && v.trim() ? v.trim() : 'Europe/Istanbul';
  // Validate IANA timezone using Intl (throws on invalid timeZone).
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return 'Europe/Istanbul';
  }
}

function normalizeIntervalHours(v: unknown): AutoSyncIntervalHours | null {
  const n = clampInt(v, 1, 24);
  if (n === 1 || n === 6 || n === 12) return n;
  return null; // null means "daily"
}

function localMinuteKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function getLocalHourMinute(date: Date, tz: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  return { hour, minute };
}

function isSourceDueNow(src: {
  autoSyncEnabled: boolean;
  autoSyncIntervalHours: number | null;
  autoSyncAtHour: number | null;
  autoSyncAtMinute: number | null;
  autoSyncTimezone: string | null;
  lastSyncAt: Date | null;
}, now: Date): boolean {
  if (!src.autoSyncEnabled) return false;
  const tz = normalizeTimezone(src.autoSyncTimezone);
  const atHour = src.autoSyncAtHour ?? 3;
  const atMinute = src.autoSyncAtMinute ?? 0;
  const { hour, minute } = getLocalHourMinute(now, tz);

  // Gate by minute first
  if (minute !== atMinute) return false;

  const interval = normalizeIntervalHours(src.autoSyncIntervalHours);
  if (interval == null) {
    // daily
    if (hour !== atHour) return false;
  } else {
    // 1/6/12-hour cadence anchored at atHour
    const diff = (hour - atHour) % interval;
    if (diff !== 0) return false;
  }

  // Prevent duplicate runs in the same scheduled minute.
  const nowKey = localMinuteKey(now, tz);
  const lastKey = src.lastSyncAt ? localMinuteKey(src.lastSyncAt, tz) : null;
  return lastKey !== nowKey;
}

function normalizeDuplicateMode(v: string | undefined | null): DuplicateMode {
  if (v === 'error' || v === 'update' || v === 'skip') return v;
  return 'update';
}

const FILE_LOCAL_URL_PREFIX = 'file-local://';

export function isFileLocalXmlSourceUrl(url: string): boolean {
  return url.trim().startsWith(FILE_LOCAL_URL_PREFIX);
}

export async function listXmlSources(tenantId: string) {
  return prisma.xmlSource.findMany({
    where:  { tenantId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getXmlSourceById(id: string, tenantId: string) {
  return prisma.xmlSource.findFirst({ where: { id, tenantId } });
}

function validateFieldMapping(fields: Record<string, string>): void {
  const mappedTargets = Object.values(fields).filter(x => x !== '__ignore__');
  if (!mappedTargets.includes('name')) {
    throw new Error('mapping: Ürün Adı (name) eşlemesi zorunludur.');
  }
  if (!mappedTargets.includes('price')) {
    throw new Error('mapping: Satış Fiyatı (price) eşlemesi zorunludur.');
  }
}

export async function createXmlSource(
  tenantId: string,
  data: {
    name: string;
    url: string;
    mapping: Record<string, string>;
    customTargetLabels?: Record<string, string>;
    customTargets?: CustomTargetDef[];
    duplicateMode?: string;
    skipZeroStock?: boolean;
    isActive?: boolean;
    autoSyncEnabled?: boolean;
    autoSyncIntervalHours?: number | null;
    autoSyncAtHour?: number | null;
    autoSyncAtMinute?: number | null;
    autoSyncTimezone?: string | null;
  },
) {
  validateFieldMapping(data.mapping);
  const mappingPayload = packStoredMapping({
    fields:             data.mapping,
    customTargetLabels: data.customTargetLabels ?? {},
    customTargets:      data.customTargets ?? [],
  });

  const created = await prisma.xmlSource.create({
    data: {
      tenantId,
      name:          data.name.trim(),
      url:           data.url.trim(),
      mapping:       mappingPayload,
      duplicateMode: normalizeDuplicateMode(data.duplicateMode),
      skipZeroStock: Boolean(data.skipZeroStock),
      isActive:      data.isActive !== false,
      autoSyncEnabled: Boolean(data.autoSyncEnabled),
      autoSyncIntervalHours: data.autoSyncEnabled ? (normalizeIntervalHours(data.autoSyncIntervalHours) as any) : null,
      autoSyncAtHour: data.autoSyncEnabled ? (clampInt(data.autoSyncAtHour, 0, 23) ?? 3) : 3,
      autoSyncAtMinute: data.autoSyncEnabled ? (clampInt(data.autoSyncAtMinute, 0, 59) ?? 0) : 0,
      autoSyncTimezone: normalizeTimezone(data.autoSyncTimezone),
    },
  });

  xmlLogger.info({
    action:   'source_create',
    status:   'success',
    tenantId,
    sourceId: created.id,
    name:     created.name,
  });

  return created;
}

export async function updateXmlSource(
  id: string,
  tenantId: string,
  data: Partial<{
    name: string;
    url: string;
    mapping: Record<string, string>;
    customTargetLabels?: Record<string, string>;
    customTargets?: CustomTargetDef[];
    duplicateMode: string;
    skipZeroStock: boolean;
    isActive: boolean;
    autoSyncEnabled: boolean;
    autoSyncIntervalHours: number | null;
    autoSyncAtHour: number | null;
    autoSyncAtMinute: number | null;
    autoSyncTimezone: string | null;
  }>,
) {
  const existing = await prisma.xmlSource.findFirst({ where: { id, tenantId } });
  if (!existing) return null;

  const stored = parseStoredMapping(existing.mapping);
  const nextFields = data.mapping != null ? data.mapping : stored.fields;
  if (data.mapping != null) validateFieldMapping(nextFields);

  const mappingPayload = (data.mapping != null || data.customTargetLabels != null || data.customTargets != null)
    ? packStoredMapping({
      fields:             nextFields,
      customTargetLabels: data.customTargetLabels ?? stored.customTargetLabels,
      customTargets:      data.customTargets ?? stored.customTargets,
    })
    : undefined;

  return prisma.xmlSource.update({
    where: { id },
    data: {
      ...(data.name != null ? { name: data.name.trim() } : {}),
      ...(data.url != null ? { url: data.url.trim() } : {}),
      ...(mappingPayload != null ? { mapping: mappingPayload } : {}),
      ...(data.duplicateMode != null ? { duplicateMode: normalizeDuplicateMode(data.duplicateMode) } : {}),
      ...(data.skipZeroStock != null ? { skipZeroStock: data.skipZeroStock } : {}),
      ...(data.isActive != null ? { isActive: data.isActive } : {}),
      ...(data.autoSyncEnabled != null ? { autoSyncEnabled: data.autoSyncEnabled } : {}),
      ...(data.autoSyncIntervalHours !== undefined
        ? { autoSyncIntervalHours: data.autoSyncIntervalHours == null ? null : (normalizeIntervalHours(data.autoSyncIntervalHours) as any) }
        : {}),
      ...(data.autoSyncAtHour !== undefined
        ? { autoSyncAtHour: data.autoSyncAtHour == null ? null : (clampInt(data.autoSyncAtHour, 0, 23) ?? 3) }
        : {}),
      ...(data.autoSyncAtMinute !== undefined
        ? { autoSyncAtMinute: data.autoSyncAtMinute == null ? null : (clampInt(data.autoSyncAtMinute, 0, 59) ?? 0) }
        : {}),
      ...(data.autoSyncTimezone !== undefined ? { autoSyncTimezone: normalizeTimezone(data.autoSyncTimezone) } : {}),
    },
  });
}

/** Kayıtlı kaynak — feed önizlemesi; kayıtlı mapping önceliklidir */
export async function previewXmlSourceFields(id: string, tenantId: string) {
  const src = await prisma.xmlSource.findFirst({ where: { id, tenantId } });
  if (!src) return null;

  if (isFileLocalXmlSourceUrl(src.url)) {
    throw new Error(
      'Bu kayıt dosya yüklemesinden oluşturuldu. Eşleştirmeyi düzenleyebilirsiniz; otomatik çekim için kaynağa HTTP(S) feed URL\'si ekleyin.',
    );
  }

  const buffer = await fetchUrlAsBuffer(src.url.trim());
  const filename = src.url.split('/').pop()?.split('?')[0] ?? `${src.name}.xml`;
  const stored = parseStoredMapping(src.mapping);
  const preview = await buildXmlUrlPreview(
    tenantId,
    buffer,
    { filename, sourceUrl: src.url.trim() },
    stored.fields,
  );

  return {
    ...preview,
    sourceId:             src.id,
    sourceName:           src.name,
    duplicateMode:        src.duplicateMode,
    skipZeroStock:        src.skipZeroStock,
    mappingJson:          buildFieldMapping(preview.xmlFields, stored.fields),
    storedMappingJson:    stored.fields,
    customTargetLabels:   stored.customTargetLabels,
    customTargets:        stored.customTargets,
  };
}

export async function deleteXmlSource(id: string, tenantId: string): Promise<boolean> {
  const r = await prisma.xmlSource.deleteMany({ where: { id, tenantId } });
  return r.count > 0;
}

/**
 * Kayıtlı kaynaktan XML indirip ürünleri günceller. `userId` ImportLog için (cron: sistem kullanıcısı).
 */
export async function syncXmlSource(
  id: string,
  tenantId: string,
  userId: string,
): Promise<XmlUrlImportPipelineResult> {
  const src = await prisma.xmlSource.findFirst({ where: { id, tenantId } });
  if (!src) {
    xmlLogger.warn({ action: 'sync', status: 'failure', tenantId, userId, sourceId: id, message: 'Source not found' });
    throw new Error('XML kaynağı bulunamadı.');
  }
  if (!src.isActive) {
    xmlLogger.info({ action: 'sync', status: 'skipped', tenantId, userId, sourceId: id, message: 'Source inactive' });
    throw new Error('Kaynak pasif; senkron atlandı.');
  }

  if (isFileLocalXmlSourceUrl(src.url)) {
    throw new Error(
      'Bu kayıt dosya yüklemesinden oluşturuldu. "XML\'i Güncelle" için kaynak düzenlemeden feed URL\'si ekleyin veya yeni dosya yükleyin.',
    );
  }

  xmlLogger.info({ action: 'sync', status: 'pending', tenantId, userId, sourceId: id, sourceName: src.name });

  let buffer: Buffer;
  try {
    buffer = await fetchUrlAsBuffer(src.url.trim());
  } catch (e: any) {
    xmlLogger.error({ action: 'sync', status: 'failure', tenantId, userId, sourceId: id, error: e, message: 'URL fetch failed' });
    await prisma.xmlSource.update({
      where: { id: src.id },
      data:  { lastSyncError: e?.message ?? 'URL indirilemedi' },
    }).catch(() => {});
    throw e;
  }

  const stored        = parseStoredMapping(src.mapping);
  const mapping       = stored.fields;
  const duplicateMode = normalizeDuplicateMode(src.duplicateMode) as DuplicateMode;

  try {
    const out = await runXmlUrlImportPipeline({
      tenantId,
      userId,
      buffer,
      mapping,
      customTargetLabels: stored.customTargetLabels,
      duplicateMode,
      skipZeroStock: src.skipZeroStock,
      startedAt:     new Date(),
      logFilename:   `xml-source:${src.name}`,
    });

    await prisma.xmlSource.update({
      where: { id: src.id },
      data:  {
        lastSyncAt:    new Date(),
        lastSyncError: null,
      },
    });

    xmlLogger.info({
      action:   'sync',
      status:   'success',
      tenantId,
      userId,
      sourceId: id,
      imported: out.summary.imported,
      updated:  out.summary.updated,
      skipped:  out.summary.skipped,
      failed:   out.summary.failed,
    });

    logBusinessEvent('xml_sync', tenantId, {
      sourceId:   id,
      sourceName: src.name,
      userId,
      imported:   out.summary.imported,
      updated:    out.summary.updated,
      skipped:    out.summary.skipped,
      failed:     out.summary.failed,
    });

    return out;
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    xmlLogger.error({ action: 'sync', status: 'failure', tenantId, userId, sourceId: id, error: e, message: msg });
    await prisma.xmlSource.update({
      where: { id: src.id },
      data:  { lastSyncError: msg },
    }).catch(() => {});
    throw e;
  }
}

/** Cron: tüm tenant’lardaki aktif kaynaklar (batch). `force`: zamanlama kontrolünü atla */
export async function syncAllActiveXmlSources(opts?: {
  systemUserId?: string;
  force?: boolean;
}): Promise<{ sources: number; errors: number }> {
  const systemUserId = opts?.systemUserId ?? '';
  const force = Boolean(opts?.force);
  const now = new Date();
  const active = await prisma.xmlSource.findMany({
    where:  force
      ? { isActive: true }
      : { isActive: true, autoSyncEnabled: true },
    select: {
      id: true,
      tenantId: true,
      lastSyncAt: true,
      autoSyncEnabled: true,
      autoSyncIntervalHours: true,
      autoSyncAtHour: true,
      autoSyncAtMinute: true,
      autoSyncTimezone: true,
    },
  });

  let errors = 0;
  let synced = 0;
  for (const row of active) {
    if (!force && !isSourceDueNow(row as any, now)) continue;
    const owner = await prisma.user.findFirst({
      where: {
        tenantId: row.tenantId,
        role:     { in: [UserRole.OWNER, UserRole.ADMIN] },
      },
      orderBy: { createdAt: 'asc' },
      select:  { id: true },
    });
    const fallback = await prisma.user.findFirst({
      where:   { tenantId: row.tenantId },
      orderBy: { createdAt: 'asc' },
      select:  { id: true },
    });
    const userId = owner?.id ?? fallback?.id ?? systemUserId;
    if (!userId) {
      errors++;
      continue;
    }
    try {
      await syncXmlSource(row.id, row.tenantId, userId);
      synced++;
    } catch (e) {
      errors++;
      xmlLogger.error({
        action:   'cron_sync',
        status:   'failure',
        tenantId: row.tenantId,
        userId,
        sourceId: row.id,
        error:    e,
      });
    }
  }

  xmlLogger.info({ action: 'cron_sync', status: 'success', sources: synced, errors, force });

  return { sources: synced, errors };
}
