import path    from 'path';
import fs      from 'fs';
import multer  from 'multer';
import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { SettingsService } from './settings.service';
import { auditService, AuditCategory } from '../audit/audit.service';

const settingsService = new SettingsService();

// ─── Multer: disk storage for logo & favicon ──────────────────────────────────

function makeUploader(subdir: 'logos' | 'favicons') {
  const dest = path.join(process.cwd(), 'uploads', subdir);
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dest),
    filename:    (req: any, file, cb) => {
      const tenantId = req.user?.tenantId ?? 'unknown';
      const ext      = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, `${tenantId}_${Date.now()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },  // 5 MB
    fileFilter: (_req, file, cb) => {
      if (/^image\//.test(file.mimetype)) cb(null, true);
      else cb(new Error('Sadece resim dosyaları kabul edilir.'));
    },
  }).single('file');
}

export const logoUploader    = makeUploader('logos');
export const faviconUploader = makeUploader('favicons');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = () => process.env.BACKEND_URL || 'http://localhost:3001';

function publicUrl(subdir: string, filename: string) {
  return `${BASE_URL()}/uploads/${subdir}/${filename}`;
}

// ─── GET /api/settings ────────────────────────────────────────────────────────

export const getSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const settings = await settingsService.getByTenant(req.user!.tenantId!);
    // Attach tenant domain info
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const tenant = await prisma.tenant.findUnique({
      where:  { id: req.user!.tenantId! },
      select: {
        name: true, slug: true, description: true, logoUrl: true, themeConfig: true,
        customDomain: true, domainVerified: true, subdomain: true,
      },
    });
    await prisma.$disconnect();

    const slugTrim = tenant?.slug?.trim() || null;
    const subTrim  = tenant?.subdomain?.trim() || null;
    const storefrontSlug = slugTrim || subTrim || null;

    const themeRoot = tenant?.themeConfig && typeof tenant.themeConfig === 'object'
      ? (tenant.themeConfig as Record<string, unknown>)
      : {};
    const contact = themeRoot.contact && typeof themeRoot.contact === 'object'
      ? (themeRoot.contact as Record<string, unknown>)
      : {};

    const tenantName = tenant?.name?.trim() || '';
    const settingsSiteName = settings.siteName?.trim() || '';
    const effectiveSiteName =
      tenantName
      || (settingsSiteName !== 'My Store' ? settingsSiteName : '')
      || settingsSiteName;

    res.json({
      success: true,
      data: {
        ...settings,
        siteName:         effectiveSiteName,
        slug:             tenant?.slug ?? null,
        subdomain:        tenant?.subdomain ?? null,
        customDomain:     tenant?.customDomain ?? null,
        domainVerified:   tenant?.domainVerified ?? false,
        storefrontSlug,
        storeName:        tenantName || effectiveSiteName,
        description:      tenant?.description ?? '',
        contactEmail:     typeof contact.email === 'string' ? contact.email : '',
        contactPhone:     typeof contact.phone === 'string' ? contact.phone : '',
        contactAddress:   typeof contact.address === 'string' ? contact.address : '',
        tenantLogoUrl:    tenant?.logoUrl ?? null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /api/settings ────────────────────────────────────────────────────────

export const updateSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId!;
    const settings = await settingsService.update(req.body, tenantId);

    await auditService.log({
      userId: req.user!.id, userEmail: req.user!.email, userRole: req.user!.role,
      tenantId,
      action: 'SETTINGS_UPDATED', category: AuditCategory.GENERAL,
      targetType: 'Settings', targetId: settings.id,
      details: { fields: Object.keys(req.body) },
      req,
    });

    res.json({ success: true, data: settings });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /api/settings/store-info ─────────────────────────────────────────────

export const updateStoreInfo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId!;
    const result = await settingsService.updateStoreInfo(tenantId, req.body ?? {});

    await auditService.log({
      userId: req.user!.id, userEmail: req.user!.email, userRole: req.user!.role,
      tenantId,
      action: 'SETTINGS_UPDATED', category: AuditCategory.GENERAL,
      targetType: 'Tenant', targetId: tenantId,
      details: { section: 'store-info' },
      req,
    });

    res.json({
      success: true,
      data: {
        ...result,
        siteName:     result.storeName,
        storeName:    result.storeName,
        logoUrl:      result.logoUrl,
        tenantLogoUrl: result.logoUrl,
        description:  result.description,
        contactEmail:   result.contactEmail,
        contactPhone:   result.contactPhone,
        contactAddress: result.contactAddress,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─── POST /api/settings/logo ──────────────────────────────────────────────────

export const uploadLogo = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ success: false, message: 'Dosya gerekli.' });
    return;
  }
  try {
    const tenantId = req.user!.tenantId!;
    const url      = publicUrl('logos', req.file.filename);
    await settingsService.setLogoUrl(tenantId, url);
    res.json({ success: true, url });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/settings/favicon ───────────────────────────────────────────────

export const uploadFavicon = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ success: false, message: 'Dosya gerekli.' });
    return;
  }
  try {
    const tenantId = req.user!.tenantId!;
    const url      = publicUrl('favicons', req.file.filename);
    await settingsService.setFaviconUrl(tenantId, url);
    res.json({ success: true, url });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /api/settings/domain ─────────────────────────────────────────────────

export const updateDomain = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId!;
    const { domain } = req.body as { domain?: string };

    const result = await settingsService.setCustomDomain(tenantId, domain ?? null);

    await auditService.log({
      userId: req.user!.id, userEmail: req.user!.email, userRole: req.user!.role,
      tenantId,
      action: 'DOMAIN_UPDATED', category: AuditCategory.GENERAL,
      targetType: 'Tenant', details: { domain }, req,
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/branding/:slug  (PUBLIC — no auth) ──────────────────────────────

export const getBranding = async (req: any, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const branding = await settingsService.getBrandingBySlug(slug);
    if (!branding) {
      res.status(404).json({ success: false, message: 'Tenant bulunamadı.' });
      return;
    }
    res.json({ success: true, data: branding });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
