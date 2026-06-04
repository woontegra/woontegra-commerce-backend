import prisma from '../../config/database';
import {
  storefrontBlogPostPath,
  storefrontCategoryPath,
  storefrontContentPagePath,
  storefrontProductPath,
  storefrontUsesCustomDomain,
} from '../store-public/store-public-seo.util';

export type MenuLinkType = 'page' | 'category' | 'blog' | 'product' | 'custom';

export function normalizeMenuType(raw: unknown): 'HEADER' | 'FOOTER' | null {
  const t = String(raw ?? '').trim().toUpperCase();
  if (t === 'HEADER' || t === 'FOOTER') return t;
  return null;
}

export function normalizeLinkType(raw: unknown): MenuLinkType | null {
  const t = String(raw ?? '').trim().toLowerCase();
  if (['page', 'category', 'blog', 'product', 'custom'].includes(t)) {
    return t as MenuLinkType;
  }
  return null;
}

function appendTenantQuery(path: string, tenantSlug: string, useCustom: boolean): string {
  if (useCustom) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}tenant=${encodeURIComponent(tenantSlug)}`;
}

export async function resolveMenuItemPath(
  tenantId: string,
  tenantSlug: string,
  customDomain: string | null,
  domainVerified: boolean,
  item: { linkType: string; targetId: string | null; url: string | null },
): Promise<string | null> {
  const linkType = normalizeLinkType(item.linkType);
  if (!linkType) return null;
  const useCustom = storefrontUsesCustomDomain(customDomain, domainVerified);

  if (linkType === 'custom') {
    const u = (item.url ?? '').trim();
    if (!u) return null;
    if (/^https?:\/\//i.test(u) || u.startsWith('mailto:') || u.startsWith('tel:')) return u;
    const path = u.startsWith('/') ? u : `/${u}`;
    return appendTenantQuery(path, tenantSlug, useCustom);
  }

  const targetId = item.targetId?.trim();
  if (!targetId) return null;

  if (linkType === 'page') {
    const page = await prisma.page.findFirst({
      where: { id: targetId, tenantId, status: 'published', isPublished: true },
      select: { slug: true },
    });
    if (!page) return null;
    return storefrontContentPagePath(page.slug, tenantSlug, useCustom);
  }

  if (linkType === 'blog') {
    const post = await prisma.post.findFirst({
      where: { id: targetId, tenantId, isPublished: true },
      select: { slug: true },
    });
    if (!post) return null;
    return storefrontBlogPostPath(post.slug, tenantSlug, useCustom);
  }

  if (linkType === 'category') {
    const cat = await prisma.category.findFirst({
      where: { id: targetId, tenantId, isActive: true },
      select: { slug: true },
    });
    if (!cat) return null;
    return storefrontCategoryPath(cat.slug, tenantSlug, useCustom);
  }

  if (linkType === 'product') {
    const product = await prisma.product.findFirst({
      where: {
        id: targetId,
        tenantId,
        isActive: true,
        status: 'active',
      },
      select: { slug: true },
    });
    if (!product) return null;
    return storefrontProductPath(product.slug, tenantSlug, useCustom);
  }

  return null;
}
