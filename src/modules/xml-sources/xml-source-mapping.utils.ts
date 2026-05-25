/** Kayıtlı XML mapping — düz Record (eski) veya { fields, customTargetLabels, customTargets } */

export type CustomTargetDef = { key: string; label: string };

export type StoredXmlMapping = {
  fields:              Record<string, string>;
  customTargetLabels:  Record<string, string>;
  customTargets:       CustomTargetDef[];
};

function asStringRecord(raw: unknown): Record<string, string> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function asCustomTargets(raw: unknown): CustomTargetDef[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomTargetDef[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      const key = typeof o.key === 'string' ? o.key : '';
      const label = typeof o.label === 'string' ? o.label : '';
      if (key && label) out.push({ key, label });
    }
  }
  return out;
}

export function parseStoredMapping(raw: unknown): StoredXmlMapping {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (o.fields != null && typeof o.fields === 'object') {
      return {
        fields:             asStringRecord(o.fields),
        customTargetLabels: asStringRecord(o.customTargetLabels),
        customTargets:      asCustomTargets(o.customTargets),
      };
    }
    return {
      fields:             asStringRecord(raw),
      customTargetLabels: {},
      customTargets:      [],
    };
  }
  return { fields: {}, customTargetLabels: {}, customTargets: [] };
}

export function packStoredMapping(parts: StoredXmlMapping): object {
  return {
    fields:             parts.fields,
    customTargetLabels: parts.customTargetLabels ?? {},
    customTargets:      parts.customTargets ?? [],
  };
}
