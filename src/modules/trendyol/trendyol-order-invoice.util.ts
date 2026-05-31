export const MAX_TRENDYOL_INVOICE_FILE_BYTES = 10 * 1024 * 1024;

/** PDF magic bytes kontrolü. */
export function isValidPdfBuffer(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

/** Trendyol sipariş rawPayload içinden shipmentPackageId çıkarır. */
export function extractShipmentPackageId(rawPayload: unknown): number | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null;

  const raw = rawPayload as Record<string, unknown>;

  const directCandidates = [
    raw.shipmentPackageId,
    raw.packageId,
    raw.id,
  ];

  for (const c of directCandidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }

  const nested = raw.shipmentPackage;
  if (nested && typeof nested === 'object') {
    const p = nested as Record<string, unknown>;
    const n = Number(p.shipmentPackageId ?? p.id ?? p.packageId);
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }

  const packages = raw.shipmentPackages ?? raw.packages;
  if (Array.isArray(packages)) {
    for (const pkg of packages) {
      if (!pkg || typeof pkg !== 'object') continue;
      const p = pkg as Record<string, unknown>;
      const n = Number(p.shipmentPackageId ?? p.id ?? p.packageId);
      if (Number.isFinite(n) && n > 0) return Math.trunc(n);
    }
  }

  return null;
}

export function parseInvoiceDateTime(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value > 1e12 ? Math.trunc(value / 1000) : Math.trunc(value);
  }

  const str = String(value).trim();
  if (!str) return undefined;

  if (/^\d+$/.test(str)) {
    const n = Number(str);
    if (Number.isFinite(n) && n > 0) {
      return n > 1e12 ? Math.trunc(n / 1000) : Math.trunc(n);
    }
  }

  const ms = Date.parse(str);
  if (Number.isFinite(ms)) return Math.trunc(ms / 1000);

  return undefined;
}

export function isHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
