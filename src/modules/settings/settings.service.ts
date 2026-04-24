import prisma from '../../config/database';

// ─── Allowed branding fields (whitelist to prevent mass-assignment) ───────────

const BRANDING_FIELDS = new Set([
  'siteName', 'logo', 'logoUrl', 'faviconUrl',
  'primaryColor', 'secondaryColor', 'accentColor',
  'fontFamily', 'borderRadius', 'customCss',
  'currency', 'language',
]);

function sanitize(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data).filter(([k]) => BRANDING_FIELDS.has(k)),
  );
}

export class SettingsService {
  async getByTenant(tenantId: string) {
    let settings = await prisma.settings.findUnique({ where: { tenantId } });

    if (!settings) {
      settings = await prisma.settings.create({
        data: { tenant: { connect: { id: tenantId } } },
      });
    }

    return settings;
  }

  async update(data: Record<string, unknown>, tenantId: string) {
    const clean = sanitize(data);

    return prisma.settings.upsert({
      where:  { tenantId },
      create: { ...clean, tenant: { connect: { id: tenantId } } },
      update: clean,
    });
  }

  /** Set logo URL after file upload */
  async setLogoUrl(tenantId: string, url: string) {
    return prisma.settings.upsert({
      where:  { tenantId },
      create: { logoUrl: url, tenant: { connect: { id: tenantId } } },
      update: { logoUrl: url },
    });
  }

  /** Set favicon URL after file upload */
  async setFaviconUrl(tenantId: string, url: string) {
    return prisma.settings.upsert({
      where:  { tenantId },
      create: { faviconUrl: url, tenant: { connect: { id: tenantId } } },
      update: { faviconUrl: url },
    });
  }

  /** Public: fetch branding by tenant slug (no auth needed) */
  async getBrandingBySlug(slug: string) {
    const tenant = await prisma.tenant.findUnique({
      where:   { slug },
      select:  {
        id:           true,
        name:         true,
        slug:         true,
        customDomain: true,
        settings:     {
          select: {
            siteName:      true,
            logoUrl:       true,
            logo:          true,
            faviconUrl:    true,
            primaryColor:  true,
            secondaryColor: true,
            accentColor:   true,
            fontFamily:    true,
            borderRadius:  true,
            customCss:     true,
            currency:      true,
            language:      true,
          },
        },
      },
    });

    if (!tenant) return null;

    return {
      tenantId:      tenant.id,
      tenantName:    tenant.name,
      slug:          tenant.slug,
      customDomain:  tenant.customDomain,
      ...tenant.settings,
    };
  }

  /** Domain management */
  async setCustomDomain(tenantId: string, domain: string | null) {
    return prisma.tenant.update({
      where: { id: tenantId },
      data:  {
        customDomain:   domain?.trim() || null,
        domainVerified: false,
      },
      select: { id: true, customDomain: true, domainVerified: true },
    });
  }
}
