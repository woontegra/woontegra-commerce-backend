import { Prisma } from '@prisma/client';
import prisma from '../../config/database';

export const HOME_PAGE_TYPE = 'HOME';

export type StorefrontLayoutSection = {
  id: string;
  type: string;
  enabled: boolean;
  settings: Record<string, unknown>;
};

export type StorefrontLayoutJson = {
  version: number;
  theme: Record<string, unknown>;
  sections: StorefrontLayoutSection[];
};

export class StorefrontBuilderError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'StorefrontBuilderError';
  }
}

export function defaultHomeLayout(): StorefrontLayoutJson {
  return {
    version: 1,
    theme: {},
    sections: [
      {
        id: 'hero_default',
        type: 'hero',
        enabled: true,
        settings: {
          title: 'Mağazanıza hoş geldiniz',
          subtitle: 'Öne çıkan ürünleri ve kampanyaları keşfedin',
          buttonText: 'Alışverişe Başla',
        },
      },
      {
        id: 'categories_default',
        type: 'categoryGrid',
        enabled: true,
        settings: {
          title: 'Kategoriler',
        },
      },
      {
        id: 'featured_default',
        type: 'featuredProducts',
        enabled: true,
        settings: {
          title: 'Öne Çıkan Ürünler',
          limit: 8,
        },
      },
    ],
  };
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StorefrontBuilderError(`${field} geçerli bir nesne olmalıdır.`);
  }
  return value as Record<string, unknown>;
}

function parseSection(raw: unknown, index: number): StorefrontLayoutSection {
  const section = asObject(raw, `sections[${index}]`);
  const id = String(section.id ?? '').trim();
  const type = String(section.type ?? '').trim();
  if (!id) {
    throw new StorefrontBuilderError(`sections[${index}].id zorunludur.`);
  }
  if (!type) {
    throw new StorefrontBuilderError(`sections[${index}].type zorunludur.`);
  }
  const enabled = section.enabled === undefined ? true : Boolean(section.enabled);
  const settingsRaw = section.settings;
  const settings =
    settingsRaw === undefined
      ? {}
      : asObject(settingsRaw, `sections[${index}].settings`);

  return { id, type, enabled, settings };
}

export function validateLayoutJson(input: unknown): StorefrontLayoutJson {
  const root = asObject(input, 'layout');
  const version = root.version;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new StorefrontBuilderError('layout.version sayı olmalıdır.');
  }
  const themeRaw = root.theme;
  const theme = themeRaw === undefined ? {} : asObject(themeRaw, 'layout.theme');
  if (!Array.isArray(root.sections)) {
    throw new StorefrontBuilderError('layout.sections dizi olmalıdır.');
  }
  const sections = root.sections.map((section, index) => parseSection(section, index));
  return {
    version,
    theme,
    sections,
  };
}

export function parseLayoutBody(body: unknown): StorefrontLayoutJson {
  if (!body || typeof body !== 'object') {
    throw new StorefrontBuilderError('Geçersiz istek gövdesi.');
  }
  const b = body as Record<string, unknown>;
  const layout = b.layout !== undefined ? b.layout : body;
  return validateLayoutJson(layout);
}

function toDraftResponse(
  row: {
    draftJson: Prisma.JsonValue;
    publishedJson: Prisma.JsonValue;
    status: string;
    version: number;
    publishedAt: Date | null;
    updatedAt: Date;
  } | null,
  isDefault: boolean,
) {
  const layout =
    row?.draftJson && typeof row.draftJson === 'object' && !Array.isArray(row.draftJson)
      ? validateLayoutJson(row.draftJson)
      : defaultHomeLayout();

  return {
    layout,
    isDefault,
    status: row?.status ?? 'DRAFT',
    version: row?.version ?? 1,
    publishedAt: row?.publishedAt?.toISOString() ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    hasPublished: Boolean(row?.publishedJson),
  };
}

export const storefrontBuilderService = {
  async getHomeDraft(tenantId: string) {
    const row = await prisma.storefrontPage.findUnique({
      where: {
        tenantId_pageType: { tenantId, pageType: HOME_PAGE_TYPE },
      },
    });

    if (!row || row.draftJson == null) {
      return toDraftResponse(row, true);
    }

    return toDraftResponse(row, false);
  },

  async saveHomeDraft(tenantId: string, layoutJson: StorefrontLayoutJson) {
    const validated = validateLayoutJson(layoutJson);
    const row = await prisma.storefrontPage.upsert({
      where: {
        tenantId_pageType: { tenantId, pageType: HOME_PAGE_TYPE },
      },
      create: {
        tenantId,
        pageType: HOME_PAGE_TYPE,
        draftJson: validated as unknown as Prisma.InputJsonValue,
        status: 'DRAFT',
        version: 1,
      },
      update: {
        draftJson: validated as unknown as Prisma.InputJsonValue,
        status: 'DRAFT',
      },
    });

    return toDraftResponse(row, false);
  },

  async publishHome(tenantId: string) {
    const row = await prisma.storefrontPage.findUnique({
      where: {
        tenantId_pageType: { tenantId, pageType: HOME_PAGE_TYPE },
      },
    });

    if (!row || row.draftJson == null) {
      throw new StorefrontBuilderError('Yayınlanacak taslak bulunamadı. Önce taslağı kaydedin.', 400);
    }

    const validated = validateLayoutJson(row.draftJson);
    const updated = await prisma.storefrontPage.update({
      where: { id: row.id },
      data: {
        publishedJson: validated as unknown as Prisma.InputJsonValue,
        status: 'PUBLISHED',
        version: row.version + 1,
        publishedAt: new Date(),
      },
    });

    return {
      layout: validated,
      status: updated.status,
      version: updated.version,
      publishedAt: updated.publishedAt?.toISOString() ?? null,
    };
  },

  async getPublicHomeLayoutBySlug(tenantSlug: string) {
    const slug = tenantSlug.trim().toLowerCase();
    if (!slug) {
      throw new StorefrontBuilderError('tenant parametresi gerekli.', 400);
    }

    const tenant = await prisma.tenant.findFirst({
      where: { slug, isActive: true },
      select: { id: true, slug: true, name: true },
    });

    if (!tenant) {
      return {
        tenant: null,
        layout: null as StorefrontLayoutJson | null,
      };
    }

    const row = await prisma.storefrontPage.findUnique({
      where: {
        tenantId_pageType: { tenantId: tenant.id, pageType: HOME_PAGE_TYPE },
      },
      select: { publishedJson: true },
    });

    if (!row?.publishedJson) {
      return {
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
        layout: null,
      };
    }

    return {
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      layout: validateLayoutJson(row.publishedJson),
    };
  },
};
