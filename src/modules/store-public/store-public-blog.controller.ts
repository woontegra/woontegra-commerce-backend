import { Request, Response } from 'express';
import prisma from '../../config/database';
import { resolveStoreTenant, tenantJson } from './store-tenant.util';
import {
  storefrontBlogListPath,
  storefrontBlogPostPath,
  storefrontUsesCustomDomain,
} from './store-public-seo.util';

const authorSelect = {
  id: true,
  firstName: true,
  lastName: true,
} as const;

function mapPublicPost(
  post: {
    id: string;
    title: string;
    slug: string;
    content: string;
    excerpt: string | null;
    coverImage: string | null;
    category: string | null;
    tags: string[];
    metaTitle: string | null;
    metaDescription: string | null;
    isPublished: boolean;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    author: { id: string; firstName: string; lastName: string };
  },
  tenantSlug: string,
  useCustom: boolean,
) {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    content: post.content,
    excerpt: post.excerpt,
    coverImage: post.coverImage,
    category: post.category,
    tags: post.tags,
    metaTitle: post.metaTitle?.trim() || post.title,
    metaDescription: post.metaDescription?.trim() || post.excerpt || '',
    isPublished: post.isPublished,
    publishedAt: post.publishedAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    canonicalPath: storefrontBlogPostPath(post.slug, tenantSlug, useCustom),
    author: post.author,
  };
}

export async function listStoreBlogPosts(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ status: 'error', error: 'Mağaza bulunamadı.' });
      return;
    }

    const useCustom = storefrontUsesCustomDomain(tenant.customDomain, tenant.domainVerified);
    const now = new Date();

    const rows = await prisma.post.findMany({
      where: {
        tenantId: tenant.id,
        isPublished: true,
        OR: [
          { publishedAt: null },
          { publishedAt: { lte: now } },
        ],
      },
      include: { author: { select: authorSelect } },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });

    res.json({
      status: 'success',
      tenant: tenantJson(tenant),
      data: rows.map(row => mapPublicPost(row, tenant.slug, useCustom)),
      listCanonicalPath: storefrontBlogListPath(tenant.slug, useCustom),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Blog yazıları alınamadı.';
    res.status(500).json({ status: 'error', error: msg });
  }
}

export async function getStoreBlogPostBySlug(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ status: 'error', error: 'Mağaza bulunamadı.' });
      return;
    }

    const raw = req.params.slug;
    const slug = typeof raw === 'string' ? raw.trim() : '';
    if (!slug) {
      res.status(400).json({ status: 'error', error: 'Geçersiz blog adresi.' });
      return;
    }

    const useCustom = storefrontUsesCustomDomain(tenant.customDomain, tenant.domainVerified);
    const now = new Date();

    const post = await prisma.post.findFirst({
      where: {
        slug,
        tenantId: tenant.id,
        isPublished: true,
        OR: [
          { publishedAt: null },
          { publishedAt: { lte: now } },
        ],
      },
      include: { author: { select: authorSelect } },
    });

    if (!post) {
      res.status(404).json({ status: 'error', error: 'Blog yazısı bulunamadı.' });
      return;
    }

    res.json({
      status: 'success',
      tenant: tenantJson(tenant),
      data: mapPublicPost(post, tenant.slug, useCustom),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Blog yazısı alınamadı.';
    res.status(500).json({ status: 'error', error: msg });
  }
}
