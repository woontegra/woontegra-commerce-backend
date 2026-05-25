import prisma from '../../config/database';
import type { TenantShippingSettingsView } from './tenant-shipping-settings.types';

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v && typeof (v as { toNumber: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const DEFAULTS: TenantShippingSettingsView = {
  isActive:              true,
  displayName:           'Standart Kargo',
  standardShippingCost:  0,
  freeShippingThreshold: null,
  description:           null,
};

export class TenantShippingSettingsService {
  async getForAdmin(tenantId: string): Promise<TenantShippingSettingsView> {
    const row = await prisma.tenantShippingSetting.findUnique({ where: { tenantId } });
    if (!row) return { ...DEFAULTS };
    return this.toView(row);
  }

  async upsert(tenantId: string, body: Record<string, unknown>): Promise<TenantShippingSettingsView> {
    const standardShippingCost = body.standardShippingCost != null
      ? Math.max(0, num(body.standardShippingCost))
      : undefined;
    const freeRaw = body.freeShippingThreshold;
    const freeShippingThreshold = freeRaw === null || freeRaw === ''
      ? null
      : freeRaw !== undefined
        ? Math.max(0, num(freeRaw))
        : undefined;

    const row = await prisma.tenantShippingSetting.upsert({
      where:  { tenantId },
      create: {
        tenantId,
        isActive:              Boolean(body.isActive ?? true),
        displayName:           typeof body.displayName === 'string' && body.displayName.trim()
          ? body.displayName.trim()
          : DEFAULTS.displayName,
        standardShippingCost:  standardShippingCost ?? DEFAULTS.standardShippingCost,
        freeShippingThreshold: freeShippingThreshold ?? null,
        description:           typeof body.description === 'string' ? body.description.trim() || null : null,
      },
      update: {
        ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
        ...(typeof body.displayName === 'string'
          ? { displayName: body.displayName.trim() || DEFAULTS.displayName }
          : {}),
        ...(standardShippingCost !== undefined ? { standardShippingCost } : {}),
        ...(freeShippingThreshold !== undefined ? { freeShippingThreshold } : {}),
        ...(typeof body.description === 'string' ? { description: body.description.trim() || null } : {}),
      },
    });
    return this.toView(row);
  }

  async getForStorefront(tenantId: string): Promise<TenantShippingSettingsView> {
    return this.getForAdmin(tenantId);
  }

  private toView(row: {
    isActive: boolean;
    displayName: string;
    standardShippingCost: unknown;
    freeShippingThreshold: unknown;
    description: string | null;
  }): TenantShippingSettingsView {
    return {
      isActive:              row.isActive,
      displayName:           row.displayName,
      standardShippingCost:  num(row.standardShippingCost),
      freeShippingThreshold: row.freeShippingThreshold != null ? num(row.freeShippingThreshold) : null,
      description:           row.description,
    };
  }
}

export const tenantShippingSettingsService = new TenantShippingSettingsService();
