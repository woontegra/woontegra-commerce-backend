/** Store-public vitrin SEO yardımcıları (aktif /store rotaları). */

export function readCustomField(cf: unknown, key: string): string | null {
  if (!cf || typeof cf !== 'object' || Array.isArray(cf)) return null;
  const v = (cf as Record<string, unknown>)[key];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}

export function stripHtmlToText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function truncateMetaDescription(text: string, maxLen = 160): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3).trimEnd()}...`;
}

export function productMetaDescription(
  name: string,
  description: string | null | undefined,
  customMeta: string | null,
): string {
  if (customMeta) return truncateMetaDescription(customMeta);
  if (description?.trim()) {
    const plain = stripHtmlToText(description);
    if (plain) return truncateMetaDescription(plain);
  }
  return truncateMetaDescription(`${name} — güvenli alışveriş ve hızlı teslimat.`);
}

export function categoryMetaDescription(
  name: string,
  description: string | null | undefined,
  customMeta: string | null,
): string {
  if (customMeta) return truncateMetaDescription(customMeta);
  if (description?.trim()) return truncateMetaDescription(stripHtmlToText(description));
  return truncateMetaDescription(`${name} kategorisindeki ürünleri keşfedin.`);
}

export function storefrontUsesCustomDomain(
  customDomain: string | null | undefined,
  domainVerified: boolean | undefined,
): boolean {
  return Boolean(domainVerified && customDomain?.trim());
}

function appendTenantQuery(path: string, tenantSlug: string, useCustomDomain: boolean): string {
  if (useCustomDomain) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}tenant=${encodeURIComponent(tenantSlug)}`;
}

export function storefrontHomePath(tenantSlug: string, useCustomDomain: boolean): string {
  return appendTenantQuery('/store', tenantSlug, useCustomDomain);
}

export function storefrontProductsListPath(tenantSlug: string, useCustomDomain: boolean): string {
  return appendTenantQuery('/store/urunler', tenantSlug, useCustomDomain);
}

export function storefrontCategoryPath(
  categorySlug: string,
  tenantSlug: string,
  useCustomDomain: boolean,
): string {
  return appendTenantQuery(
    `/store/kategori/${encodeURIComponent(categorySlug)}`,
    tenantSlug,
    useCustomDomain,
  );
}

export function storefrontProductPath(
  productSlug: string,
  tenantSlug: string,
  useCustomDomain: boolean,
): string {
  return appendTenantQuery(
    `/store/urun/${encodeURIComponent(productSlug)}`,
    tenantSlug,
    useCustomDomain,
  );
}

export function storefrontBlogListPath(tenantSlug: string, useCustomDomain: boolean): string {
  return appendTenantQuery('/store/blog', tenantSlug, useCustomDomain);
}

export function storefrontBlogPostPath(
  postSlug: string,
  tenantSlug: string,
  useCustomDomain: boolean,
): string {
  return appendTenantQuery(
    `/store/blog/${encodeURIComponent(postSlug)}`,
    tenantSlug,
    useCustomDomain,
  );
}

/** Sitemap XML içinde güvenli &lt;loc&gt; değeri. */
export function escapeXmlLoc(url: string): string {
  return url
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function resolveStorefrontFrontendOrigin(): string {
  const raw =
    process.env.FRONTEND_URL?.trim() ||
    process.env.VITE_FRONTEND_URL?.trim() ||
    '';
  return raw.replace(/\/$/, '');
}

/** Vitrin sayfası için tam URL (canonical / sitemap loc ile aynı mantık). */
export function resolveStorefrontAbsoluteUrl(
  tenantSlug: string,
  relativePath: string,
  customDomain: string | null | undefined,
  domainVerified: boolean | undefined,
): string {
  const useCustom = storefrontUsesCustomDomain(customDomain, domainVerified);
  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;

  if (useCustom) {
    const host = customDomain!.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const pathname = path.split('?')[0] || '/';
    return `https://${host}${pathname}`;
  }

  const origin = resolveStorefrontFrontendOrigin();
  return origin ? `${origin}${path}` : path;
}
