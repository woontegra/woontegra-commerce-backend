import { Request, Response } from 'express';
import prisma from '../../config/database';
import { resolveStoreTenant, tenantJson } from './store-tenant.util';
import {
  storefrontContentPagePath,
  storefrontUsesCustomDomain,
} from './store-public-seo.util';

function mapPublicPage(
  page: {
    id: string;
    title: string;
    slug: string;
    content: string;
    excerpt: string | null;
    coverImageUrl: string | null;
    status: string;
    metaTitle: string | null;
    metaDescription: string | null;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  tenantSlug: string,
  useCustom: boolean,
) {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    content: page.content,
    excerpt: page.excerpt,
    coverImageUrl: page.coverImageUrl,
    metaTitle: page.metaTitle?.trim() || page.title,
    metaDescription: page.metaDescription?.trim() || page.excerpt || '',
    publishedAt: page.publishedAt,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    canonicalPath: storefrontContentPagePath(page.slug, tenantSlug, useCustom),
  };
}

export async function getStorePageBySlug(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ status: 'error', error: 'Mağaza bulunamadı.' });
      return;
    }

    const raw = req.params.slug;
    const slug = typeof raw === 'string' ? raw.trim() : '';
    if (!slug) {
      res.status(400).json({ status: 'error', error: 'Geçersiz sayfa adresi.' });
      return;
    }

    const useCustom = storefrontUsesCustomDomain(tenant.customDomain, tenant.domainVerified);
    const now = new Date();

    const page = await prisma.page.findFirst({
      where: {
        slug,
        tenantId: tenant.id,
        status: 'published',
        isPublished: true,
        OR: [{ publishedAt: null }, { publishedAt: { lte: now } }],
      },
    });

    if (!page) {
      res.status(404).json({ status: 'error', error: 'Sayfa bulunamadı.' });
      return;
    }

    res.json({
      status: 'success',
      tenant: tenantJson(tenant),
      data: mapPublicPage(page, tenant.slug, useCustom),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Sayfa alınamadı.';
    res.status(500).json({ status: 'error', error: msg });
  }
}
