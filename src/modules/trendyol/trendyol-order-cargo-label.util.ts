/** Trendyol siparişinden kargo takip numarasını çıkarır. */
export function extractCargoTrackingNumber(
  cargoTrackingNumber: string | null | undefined,
  rawPayload: unknown,
): string | null {
  if (cargoTrackingNumber?.trim()) return cargoTrackingNumber.trim();

  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const raw = rawPayload as Record<string, unknown>;

  const directCandidates = [
    raw.cargoTrackingNumber,
    raw.trackingNumber,
  ];

  for (const c of directCandidates) {
    if (c != null && String(c).trim()) return String(c).trim();
  }

  const nested = raw.shipmentPackage;
  if (nested && typeof nested === 'object') {
    const p = nested as Record<string, unknown>;
    const n = p.cargoTrackingNumber ?? p.trackingNumber;
    if (n != null && String(n).trim()) return String(n).trim();
  }

  const packages = raw.shipmentPackages ?? raw.packages;
  if (Array.isArray(packages)) {
    for (const pkg of packages) {
      if (!pkg || typeof pkg !== 'object') continue;
      const p = pkg as Record<string, unknown>;
      const n = p.cargoTrackingNumber ?? p.trackingNumber;
      if (n != null && String(n).trim()) return String(n).trim();
    }
  }

  return null;
}

export interface CargoLabelOrderContext {
  cargoProviderName: string | null;
  orderStatus:       string;
}

export function extractCargoLabelOrderContext(
  rawPayload: unknown,
  orderStatus: string,
): CargoLabelOrderContext {
  const raw = (rawPayload && typeof rawPayload === 'object')
    ? rawPayload as Record<string, unknown>
    : {};

  const cargoProviderName = [
    raw.cargoProviderName,
    raw.cargoProvider,
    raw.shipmentPackage && typeof raw.shipmentPackage === 'object'
      ? (raw.shipmentPackage as Record<string, unknown>).cargoProviderName
      : null,
  ]
    .map(v => (v != null ? String(v).trim() : ''))
    .find(Boolean) ?? null;

  const statusNorm = String(orderStatus ?? raw.status ?? raw.shipmentPackageStatus ?? '')
    .trim()
    .toUpperCase();

  return {
    cargoProviderName,
    orderStatus: statusNorm || String(orderStatus ?? ''),
  };
}

export function isPdfUrl(label: string): boolean {
  const trimmed = label.trim();
  return /^https?:\/\//i.test(trimmed) && /\.pdf(\?|$)/i.test(trimmed);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
