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

export type StoreInfoInput = {
  storeName?:      string;
  description?:    string;
  logoUrl?:        string;
  contactEmail?:   string;
  contactPhone?:   string;
  contactAddress?: string;
};

function readContact(themeConfig: unknown) {
  const root = themeConfig && typeof themeConfig === 'object' ? (themeConfig as Record<string, unknown>) : {};
  const contact = root.contact && typeof root.contact === 'object'
    ? (root.contact as Record<string, unknown>)
    : {};
  return {
    contactEmail:   typeof contact.email === 'string' ? contact.email : '',
    contactPhone:   typeof contact.phone === 'string' ? contact.phone : '',
    contactAddress: typeof contact.address === 'string' ? contact.address : '',
  };
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

  /** Mağaza vitrin + panel adı, logo, iletişim (themeConfig.contact). */
  async updateStoreInfo(tenantId: string, input: StoreInfoInput) {
    const tenant = await prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { themeConfig: true },
    });
    if (!tenant) throw new Error('Tenant bulunamadı.');

    const storeName = typeof input.storeName === 'string' ? input.storeName.trim() : '';
    const resolvedName = storeName || 'Mağazam';
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    const logoUrl = typeof input.logoUrl === 'string' ? input.logoUrl.trim() : '';

    const prevConfig = tenant.themeConfig && typeof tenant.themeConfig === 'object'
      ? (tenant.themeConfig as Record<string, unknown>)
      : {};

    const nextConfig = {
      ...prevConfig,
      contact: {
        email:   typeof input.contactEmail === 'string' ? input.contactEmail.trim() : '',
        phone:   typeof input.contactPhone === 'string' ? input.contactPhone.trim() : '',
        address: typeof input.contactAddress === 'string' ? input.contactAddress.trim() : '',
      },
    };

    const [updatedTenant, updatedSettings] = await prisma.$transaction([
      prisma.tenant.update({
        where: { id: tenantId },
        data: {
          name:        resolvedName,
          description: description || null,
          logoUrl:     logoUrl || null,
          themeConfig: nextConfig,
        },
        select: {
          id: true, name: true, description: true, logoUrl: true, themeConfig: true,
          slug: true, subdomain: true, customDomain: true, domainVerified: true,
        },
      }),
      prisma.settings.upsert({
        where:  { tenantId },
        create: {
          siteName: resolvedName,
          logoUrl:  logoUrl || null,
          tenant:   { connect: { id: tenantId } },
        },
        update: {
          siteName: resolvedName,
          logoUrl:  logoUrl || null,
        },
      }),
    ]);

    const contact = readContact(updatedTenant.themeConfig);
    return {
      settings: updatedSettings,
      tenant:   updatedTenant,
      storeName:        updatedTenant.name,
      description:      updatedTenant.description ?? '',
      logoUrl:          updatedTenant.logoUrl ?? updatedSettings.logoUrl ?? '',
      ...contact,
    };
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
