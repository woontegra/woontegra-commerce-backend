import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger';
import { DEFAULT_FEATURES, FeatureKey, PLAN_FEATURES, getMinPlanForFeature } from './feature.constants';

const prisma = new PrismaClient();

// ─── In-memory cache: tenantId → { featureKey → enabled } ───────────────────
const cache = new Map<string, { flags: Record<string, boolean>; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

function getCached(tenantId: string): Record<string, boolean> | null {
  const entry = cache.get(tenantId);
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(tenantId);
    return null;
  }
  return entry.flags;
}

function setCached(tenantId: string, flags: Record<string, boolean>) {
  cache.set(tenantId, { flags, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateCache(tenantId: string) {
  cache.delete(tenantId);
}

// ─── FeatureService ───────────────────────────────────────────────────────────

export class FeatureService {

  /** Ensure all features exist in DB (idempotent — safe to call on startup) */
  async syncFeatureDefinitions() {
    for (const f of DEFAULT_FEATURES) {
      await prisma.feature.upsert({
        where: { key: f.key },
        update: { name: f.name, description: f.description, category: f.category, defaultOn: f.defaultOn },
        create: { key: f.key, name: f.name, description: f.description, category: f.category, defaultOn: f.defaultOn },
      });
    }
    logger.info({ message: `[FeatureService] Synced ${DEFAULT_FEATURES.length} feature definitions` });
  }

  /** Returns the active plan for a tenant (defaults to STARTER if no active sub) */
  async getTenantPlan(tenantId: string): Promise<'STARTER' | 'PRO' | 'ENTERPRISE'> {
    const sub = await prisma.subscription.findFirst({
      where:   { tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select:  { plan: true },
    });
    return (sub?.plan as 'STARTER' | 'PRO' | 'ENTERPRISE') ?? 'STARTER';
  }

  /** Returns the feature keys included in a plan */
  getPlanFeatureKeys(plan: string): FeatureKey[] {
    return PLAN_FEATURES[plan] ?? PLAN_FEATURES['STARTER'];
  }

  /** Get all feature flags for a tenant (plan-based + admin overrides, cached) */
  async getTenantFlags(tenantId: string): Promise<Record<string, boolean>> {
    const cached = getCached(tenantId);
    if (cached) return cached;

    const [features, plan] = await Promise.all([
      prisma.feature.findMany({
        include: { tenantFeatures: { where: { tenantId } } },
      }),
      this.getTenantPlan(tenantId),
    ]);

    const planKeys = this.getPlanFeatureKeys(plan);

    const flags: Record<string, boolean> = {};
    for (const f of features) {
      const override = f.tenantFeatures[0];
      if (override) {
        // Admin explicitly set this — honor it regardless of plan
        flags[f.key] = override.enabled;
      } else {
        // Plan-based: enabled if in plan's feature set
        flags[f.key] = planKeys.includes(f.key as FeatureKey);
      }
    }

    setCached(tenantId, flags);
    return flags;
  }

  /** Check a single feature for a tenant */
  async isEnabled(tenantId: string, featureKey: FeatureKey): Promise<boolean> {
    const flags = await this.getTenantFlags(tenantId);
    return flags[featureKey] ?? false;
  }

  /** Toggle (or set) a feature for a tenant */
  async setFeature(tenantId: string, featureKey: FeatureKey, enabled: boolean): Promise<void> {
    const feature = await prisma.feature.findUnique({ where: { key: featureKey } });
    if (!feature) throw new Error(`Feature "${featureKey}" bulunamadı.`);

    await prisma.tenantFeature.upsert({
      where:  { tenantId_featureId: { tenantId, featureId: feature.id } },
      update: { enabled },
      create: { tenantId, featureId: feature.id, enabled },
    });

    invalidateCache(tenantId);

    logger.info({ message: '[FeatureService] Feature updated', tenantId, featureKey, enabled });
  }

  /** Bulk set multiple features at once */
  async bulkSetFeatures(tenantId: string, overrides: Record<string, boolean>): Promise<void> {
    const features = await prisma.feature.findMany({
      where: { key: { in: Object.keys(overrides) } },
    });

    for (const feature of features) {
      const enabled = overrides[feature.key];
      await prisma.tenantFeature.upsert({
        where:  { tenantId_featureId: { tenantId, featureId: feature.id } },
        update: { enabled },
        create: { tenantId, featureId: feature.id, enabled },
      });
    }

    invalidateCache(tenantId);
  }

  /** Reset all overrides for a tenant (reverts to defaults) */
  async resetToDefaults(tenantId: string): Promise<void> {
    await prisma.tenantFeature.deleteMany({ where: { tenantId } });
    invalidateCache(tenantId);
    logger.info({ message: '[FeatureService] Tenant features reset to defaults', tenantId });
  }

  /** Get all features with their current state for a tenant (for admin UI) */
  async getFeatureMatrix(tenantId: string) {
    const features = await prisma.feature.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: {
        tenantFeatures: { where: { tenantId } },
      },
    });

    return features.map((f) => {
      const override = f.tenantFeatures[0];
      return {
        id:          f.id,
        key:         f.key,
        name:        f.name,
        description: f.description,
        category:    f.category,
        defaultOn:   f.defaultOn,
        enabled:     override ? override.enabled : f.defaultOn,
        overridden:  !!override,
      };
    });
  }

  /** List all feature definitions (no tenant context) */
  async listFeatures() {
    return prisma.feature.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }
}
