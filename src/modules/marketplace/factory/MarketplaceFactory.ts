/**
 * MarketplaceFactory
 *
 * slug + credentials → IMarketplaceProvider
 *
 * Yeni pazaryeri eklemek:
 *   1. Provider yaz (IMarketplaceProvider implement et)
 *   2. REGISTRY'e ekle
 *   3. Bitti — tüm sistem otomatik çalışır
 */

import { IMarketplaceProvider, ProviderConfig } from '../core/interfaces/IMarketplaceProvider';

// ── Provider registry ─────────────────────────────────────────────────────────
// Her giriş: slug → lazy import fonksiyonu
// Lazy import sayesinde aktif olmayan provider'lar belleğe yüklenmez.

type ProviderConstructor = new (config: ProviderConfig) => IMarketplaceProvider;

const REGISTRY: Record<string, () => Promise<ProviderConstructor>> = {
  trendyol:    () => import('../providers/trendyol/TrendyolProvider').then(m => m.TrendyolProvider),
  n11:         () => import('../providers/n11/N11Provider').then(m => m.N11Provider),
  hepsiburada: () => import('../providers/hepsiburada/HepsiburadaProvider').then(m => m.HepsiburadaProvider),
  amazon:      () => import('../providers/amazon/AmazonProvider').then(m => m.AmazonProvider),
  etsy:        () => import('../providers/etsy/EtsyProvider').then(m => m.EtsyProvider),
  ciceksepeti: () => import('../providers/ciceksepeti/CicekSepetiProvider').then(m => m.CicekSepetiProvider),
};

// Bilinen tüm pazaryeri slug'ları
export const KNOWN_MARKETPLACE_SLUGS = Object.keys(REGISTRY);

/**
 * Verilen slug için bir provider instance'ı döner.
 * Config içinde mutlaka credentials ve tenantId olmalı.
 */
export async function getMarketplaceProvider(
  slug:   string,
  config: ProviderConfig,
): Promise<IMarketplaceProvider> {
  const loader = REGISTRY[slug.toLowerCase()];
  if (!loader) {
    throw new Error(`Bilinmeyen pazaryeri: "${slug}". Desteklenenler: ${KNOWN_MARKETPLACE_SLUGS.join(', ')}`);
  }
  const ProviderClass = await loader();
  return new ProviderClass(config);
}

/**
 * Slug'ın kayıtlı olup olmadığını kontrol eder.
 */
export function isKnownMarketplace(slug: string): boolean {
  return slug.toLowerCase() in REGISTRY;
}
