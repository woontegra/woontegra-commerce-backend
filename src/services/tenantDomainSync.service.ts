import type { Tenant } from '@prisma/client';
import prisma from '../config/database';

/**
 * tenants.subdomain / tenants.customDomain ile tenant_domains senkronu.
 * Subdomain: tek kayıt. Custom: tenant üzerindeki birincil domain ile eşleşen kayıt (doğrulama satırı).
 */
export async function syncTenantDomainsFromTenant(tenant: Pick<Tenant, 'id' | 'subdomain' | 'customDomain' | 'domainVerified'>): Promise<void> {
  const tenantId = tenant.id;

  await prisma.tenantDomain.deleteMany({
    where: { tenantId, type: 'subdomain' },
  });

  const sub = tenant.subdomain?.trim().toLowerCase() || null;
  if (sub) {
    await prisma.tenantDomain.upsert({
      where: { domain: sub },
      create: { tenantId, domain: sub, type: 'subdomain', isVerified: true },
      update: { tenantId, type: 'subdomain', isVerified: true },
    });
  }

  const custom = tenant.customDomain?.trim().toLowerCase() || null;
  if (!custom) {
    await prisma.tenantDomain.deleteMany({ where: { tenantId, type: 'custom' } });
    return;
  }

  await prisma.tenantDomain.deleteMany({
    where: { tenantId, type: 'custom', domain: { not: custom } },
  });

  const verified = !!tenant.domainVerified;
  await prisma.tenantDomain.upsert({
    where: { domain: custom },
    create: {
      tenantId,
      domain: custom,
      type:       'custom',
      isVerified: verified,
    },
    update: {
      tenantId,
      isVerified: verified,
    },
  });
}
