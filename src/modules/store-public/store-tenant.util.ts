import { Request } from 'express';
import prisma from '../../config/database';
import { resolveTenantFromHost } from '../../services/tenantDomainResolve.service';

export type StoreTenantPublic = {
  id:      string;
  name:    string;
  slug:    string;
  theme:   string;
  logoUrl: string | null;
};

function tenantThemeFromRow(row: unknown): string {
  const v = (row as Record<string, unknown>).theme;
  if (typeof v === 'string' && v.trim()) return v.trim();
  return 'default';
}

function pickHost(req: Request): string {
  const xf   = req.get('x-store-frontend-host') || req.get('x-forwarded-host');
  const raw  = (xf || req.get('host') || '').split(',')[0]?.trim().toLowerCase() || '';
  return raw;
}

/**
 * Kiracı çözümü: ?tenant=slug (öncelik), yoksa host / X-Store-Frontend-Host.
 */
export async function resolveStoreTenant(req: Request): Promise<StoreTenantPublic | null> {
  const q = req.query.tenant;
  const slugFromQuery = typeof q === 'string' && q.trim() ? q.trim().toLowerCase() : null;

  if (slugFromQuery) {
    const t = await prisma.tenant.findFirst({
      where: { slug: slugFromQuery, isActive: true },
    });
    return t
      ? {
          id:      t.id,
          name:    t.name,
          slug:    t.slug,
          theme:   tenantThemeFromRow(t),
          logoUrl: t.logoUrl,
        }
      : null;
  }

  const host    = pickHost(req);
  const resolved = host ? await resolveTenantFromHost(host) : null;
  if (!resolved) return null;

  const t = await prisma.tenant.findFirst({
    where: { id: resolved.id, isActive: true },
  });
  return t
    ? {
        id:      t.id,
        name:    t.name,
        slug:    t.slug,
        theme:   tenantThemeFromRow(t),
        logoUrl: t.logoUrl,
      }
    : null;
}

export function tenantJson(t: StoreTenantPublic) {
  const name = t.name?.trim() || 'Mağaza';
  return {
    id:      t.id,
    name,
    slug:    t.slug,
    theme:   t.theme,
    logoUrl: t.logoUrl,
  };
}
