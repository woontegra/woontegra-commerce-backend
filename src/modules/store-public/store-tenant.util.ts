import { Request } from 'express';
import prisma from '../../config/database';
import { resolveTenantFromHost } from '../../services/tenantDomainResolve.service';

export type StoreTenantPublic = {
  id:               string;
  name:             string;
  slug:             string;
  theme:            string;
  logoUrl:          string | null;
  faviconUrl:       string | null;
  siteDescription:  string | null;
  customDomain:     string | null;
  domainVerified:   boolean;
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

async function enrichStoreTenantPublic(t: {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  theme?: unknown;
  description?: string | null;
  customDomain?: string | null;
  domainVerified?: boolean;
}): Promise<StoreTenantPublic> {
  const settings = await prisma.settings.findUnique({
    where:  { tenantId: t.id },
    select: { logoUrl: true, faviconUrl: true },
  });
  const tenantLogo = t.logoUrl?.trim() || null;
  const settingsLogo = settings?.logoUrl?.trim() || null;
  const siteDescription = t.description?.trim() || null;
  return {
    id:              t.id,
    name:            t.name,
    slug:            t.slug,
    theme:           tenantThemeFromRow(t),
    logoUrl:         tenantLogo ?? settingsLogo,
    faviconUrl:      settings?.faviconUrl?.trim() || null,
    siteDescription,
    customDomain:    t.customDomain?.trim() || null,
    domainVerified:  Boolean(t.domainVerified),
  };
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
    return t ? enrichStoreTenantPublic(t) : null;
  }

  const host    = pickHost(req);
  const resolved = host ? await resolveTenantFromHost(host) : null;
  if (!resolved) return null;

  const t = await prisma.tenant.findFirst({
    where: { id: resolved.id, isActive: true },
  });
  return t ? enrichStoreTenantPublic(t) : null;
}

export function tenantJson(t: StoreTenantPublic) {
  const name = t.name?.trim() || 'Mağaza';
  return {
    id:              t.id,
    name,
    slug:            t.slug,
    theme:           t.theme,
    logoUrl:         t.logoUrl,
    faviconUrl:      t.faviconUrl,
    siteDescription: t.siteDescription,
    customDomain:    t.customDomain,
    domainVerified:  t.domainVerified,
  };
}
