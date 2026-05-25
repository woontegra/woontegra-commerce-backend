import type { XmlSource } from '@prisma/client';
import { parseStoredMapping } from './xml-source-mapping.utils';

/** API yanıtı — DB: mapping → mappingJson, lastSyncAt → lastFetchedAt */
export type XmlSourcePublic = {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  mappingJson: Record<string, string>;
  customTargetLabels: Record<string, string>;
  customTargets: Array<{ key: string; label: string }>;
  duplicateMode: string;
  skipZeroStock: boolean;
  isActive: boolean;
  autoSyncEnabled: boolean;
  autoSyncIntervalHours: number | null;
  autoSyncAtHour: number | null;
  autoSyncAtMinute: number | null;
  autoSyncTimezone: string;
  lastFetchedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toXmlSourcePublic(row: XmlSource): XmlSourcePublic {
  const stored = parseStoredMapping(row.mapping);
  return {
    id:                    row.id,
    tenantId:              row.tenantId,
    name:                  row.name,
    url:                   row.url,
    mappingJson:           stored.fields,
    customTargetLabels:    stored.customTargetLabels,
    customTargets:         stored.customTargets,
    duplicateMode:       row.duplicateMode,
    skipZeroStock:         row.skipZeroStock,
    isActive:              row.isActive,
    autoSyncEnabled:       row.autoSyncEnabled,
    autoSyncIntervalHours: row.autoSyncIntervalHours,
    autoSyncAtHour:        row.autoSyncAtHour,
    autoSyncAtMinute:      row.autoSyncAtMinute,
    autoSyncTimezone:      row.autoSyncTimezone ?? 'Europe/Istanbul',
    lastFetchedAt:         row.lastSyncAt?.toISOString() ?? null,
    lastSyncError:         row.lastSyncError,
    createdAt:             row.createdAt.toISOString(),
    updatedAt:             row.updatedAt.toISOString(),
  };
}
