import prisma from '../config/database';

export interface ResolvedTenantHost {
  id:           string;
  name:         string;
  slug:         string;
  subdomain:    string | null;
  customDomain: string | null;
}

function normalizeHost(host: string): string {
  return (host.split(':')[0] || '').toLowerCase().trim();
}

const TENANT_SELECT = {
  id: true, name: true, slug: true, subdomain: true, customDomain: true, isActive: true,
} as const;

/**
 * Host üzerinden tenant çözümler:
 * 1) tenant_domains custom + doğrulanmış
 * 2) tenants.customDomain (legacy)
 * 3) tenant_domains subdomain
 * 4) tenants.subdomain (legacy)
 */
export async function resolveTenantFromHost(rawHost: string): Promise<ResolvedTenantHost | null> {
  const host = normalizeHost(rawHost);
  if (!host) return null;

  const customRow = await prisma.tenantDomain.findFirst({
    where: {
      type:       'custom',
      domain:     host,
      isVerified: true,
      tenant:     { isActive: true },
    },
    include: { tenant: { select: TENANT_SELECT } },
  });
  if (customRow?.tenant?.isActive) {
    const t = customRow.tenant;
    return {
      id: t.id, name: t.name, slug: t.slug, subdomain: t.subdomain, customDomain: t.customDomain,
    };
  }

  const legacyCustom = await prisma.tenant.findFirst({
    where: {
      customDomain: host,
      domainVerified: true,
      isActive:       true,
    },
    select: TENANT_SELECT,
  });
  if (legacyCustom?.isActive) {
    return {
      id:           legacyCustom.id,
      name:         legacyCustom.name,
      slug:         legacyCustom.slug,
      subdomain:    legacyCustom.subdomain,
      customDomain: legacyCustom.customDomain,
    };
  }

  const platformRoot = process.env.TENANT_PLATFORM_BASE_DOMAIN?.toLowerCase().trim();
  let label: string | null = null;

  if (platformRoot && host === platformRoot) {
    label = null;
  } else if (platformRoot && host.endsWith(`.${platformRoot}`)) {
    const prefix = host.slice(0, -(platformRoot.length + 1));
    label = prefix.split('.')[0] || null;
  } else {
    const parts = host.split('.');
    if (parts.length >= 2) {
      const sub = parts[0];
      if (sub && sub !== 'www' && sub !== 'api' && sub !== 'localhost') {
        label = sub.toLowerCase();
      }
    }
  }

  if (label) {
    const subRow = await prisma.tenantDomain.findFirst({
      where: {
        type:   'subdomain',
        domain: label,
        tenant: { isActive: true },
      },
      include: { tenant: { select: TENANT_SELECT } },
    });
    if (subRow?.tenant?.isActive) {
      const t = subRow.tenant;
      return {
        id: t.id, name: t.name, slug: t.slug, subdomain: t.subdomain, customDomain: t.customDomain,
      };
    }

    const legacySub = await prisma.tenant.findFirst({
      where: { subdomain: label, isActive: true },
      select: TENANT_SELECT,
    });
    if (legacySub?.isActive) {
      return {
        id:           legacySub.id,
        name:         legacySub.name,
        slug:         legacySub.slug,
        subdomain:    legacySub.subdomain,
        customDomain: legacySub.customDomain,
      };
    }
  }

  return null;
}
