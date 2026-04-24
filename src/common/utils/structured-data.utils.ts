/**
 * JSON-LD Structured Data Utilities for SEO
 * Generates structured data for products, categories, and stores
 */

interface ProductStructuredData {
  '@context': string;
  '@type': string;
  name: string;
  description?: string;
  image?: string[];
  brand?: {
    '@type': string;
    name: string;
  };
  sku?: string;
  offers?: {
    '@type': string;
    priceCurrency: string;
    price: number;
    availability: string;
    url?: string;
  };
  category?: string;
  url?: string;
}

interface CategoryStructuredData {
  '@context': string;
  '@type': string;
  name: string;
  description?: string;
  url?: string;
}

interface StoreStructuredData {
  '@context': string;
  '@type': string;
  name: string;
  description?: string;
  url?: string;
  image?: string[];
  sameAs?: string[];
}

/**
 * Ürün için JSON-LD structured data oluşturur
 */
export function generateProductStructuredData(product: any, tenant: any): ProductStructuredData {
  const baseUrl = process.env.FRONTEND_URL || 'https://localhost:3000';
  const productUrl = `${baseUrl}/store/${tenant.slug}/product/${product.slug}`;
  
  // Stok durumu belirleme
  let availability = 'https://schema.org/InStock';
  if (!product.isActive || product.stock === 0) {
    availability = 'https://schema.org/OutOfStock';
  } else if (product.stock <= 5) {
    availability = 'https://schema.org/LimitedAvailability';
  }

  const structuredData: ProductStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.seoTitle || product.name,
    description: product.seoDescription || product.description,
    url: productUrl,
    sku: product.sku,
    category: product.category?.name,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'TRY',
      price: product.price,
      availability,
      url: productUrl,
    },
  };

  // Görselleri ekle
  if (product.images && product.images.length > 0) {
    structuredData.image = product.images.map((img: string) => {
      // Eğer görsel URL'i tam değilse base URL ekle
      return img.startsWith('http') ? img : `${baseUrl}/uploads/${img}`;
    });
  }

  // Marka bilgisi ekle
  if (tenant.name) {
    structuredData.brand = {
      '@type': 'Brand',
      name: tenant.name,
    };
  }

  return structuredData;
}

/**
 * Kategori için JSON-LD structured data oluşturur
 */
export function generateCategoryStructuredData(category: any, tenant: any): CategoryStructuredData {
  const baseUrl = process.env.FRONTEND_URL || 'https://localhost:3000';
  const categoryUrl = `${baseUrl}/store/${tenant.slug}/category/${category.slug}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: category.seoTitle || category.name,
    description: category.seoDescription || category.description,
    url: categoryUrl,
  };
}

/**
 * Mağaza için JSON-LD structured data oluşturur
 */
export function generateStoreStructuredData(tenant: any): StoreStructuredData {
  const baseUrl = process.env.FRONTEND_URL || 'https://localhost:3000';
  const storeUrl = `${baseUrl}/store/${tenant.slug}`;

  const structuredData: StoreStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: tenant.name,
    description: tenant.description,
    url: storeUrl,
  };

  // Logo veya görsel varsa ekle
  if (tenant.logo) {
    structuredData.image = [tenant.logo.startsWith('http') ? tenant.logo : `${baseUrl}/uploads/${tenant.logo}`];
  }

  // Sosyal medya linkleri varsa ekle
  const socialLinks = [];
  if (tenant.website) socialLinks.push(tenant.website);
  if (tenant.instagram) socialLinks.push(`https://instagram.com/${tenant.instagram.replace('@', '')}`);
  if (tenant.facebook) socialLinks.push(`https://facebook.com/${tenant.facebook}`);
  if (tenant.twitter) socialLinks.push(`https://twitter.com/${tenant.twitter.replace('@', '')}`);
  
  if (socialLinks.length > 0) {
    structuredData.sameAs = socialLinks;
  }

  return structuredData;
}

/**
 * Breadcrumb için JSON-LD structured data oluşturur
 */
export function generateBreadcrumbStructuredData(breadcrumbs: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbs.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/**
 * Ürün sayfası breadcrumb'ı oluşturur
 */
export function generateProductBreadcrumb(product: any, tenant: any) {
  const baseUrl = process.env.FRONTEND_URL || 'https://localhost:3000';
  
  const breadcrumbs = [
    { name: 'Ana Sayfa', url: `${baseUrl}/store/${tenant.slug}` },
  ];

  if (product.category) {
    breadcrumbs.push({
      name: product.category.name,
      url: `${baseUrl}/store/${tenant.slug}/category/${product.category.slug}`,
    });
  }

  breadcrumbs.push({
    name: product.name,
    url: `${baseUrl}/store/${tenant.slug}/product/${product.slug}`,
  });

  return generateBreadcrumbStructuredData(breadcrumbs);
}

/**
 * HTML script tag'i olarak structured data döndürür
 */
export function renderStructuredDataAsScript(data: any): string {
  return `<script type="application/ld+json">${JSON.stringify(data, null, 2)}</script>`;
}

/**
 * Ürün sayfası için tüm structured data'ları birleştirir
 */
export function generateProductPageStructuredData(product: any, tenant: any): string[] {
  const scripts: string[] = [];

  // Ürün bilgisi
  scripts.push(renderStructuredDataAsScript(generateProductStructuredData(product, tenant)));

  // Breadcrumb
  scripts.push(renderStructuredDataAsScript(generateProductBreadcrumb(product, tenant)));

  // Mağaza bilgisi
  scripts.push(renderStructuredDataAsScript(generateStoreStructuredData(tenant)));

  return scripts;
}

/**
 * Kategori sayfası için tüm structured data'ları birleştirir
 */
export function generateCategoryPageStructuredData(category: any, tenant: any): string[] {
  const scripts: string[] = [];

  // Kategori bilgisi
  scripts.push(renderStructuredDataAsScript(generateCategoryStructuredData(category, tenant)));

  // Breadcrumb
  const breadcrumbs = [
    { name: 'Ana Sayfa', url: `${process.env.FRONTEND_URL}/store/${tenant.slug}` },
    { name: category.name, url: `${process.env.FRONTEND_URL}/store/${tenant.slug}/category/${category.slug}` },
  ];
  scripts.push(renderStructuredDataAsScript(generateBreadcrumbStructuredData(breadcrumbs)));

  // Mağaza bilgisi
  scripts.push(renderStructuredDataAsScript(generateStoreStructuredData(tenant)));

  return scripts;
}

/**
 * Ana mağaza sayfası için structured data
 */
export function generateStorePageStructuredData(tenant: any): string[] {
  const scripts: string[] = [];

  // Mağaza bilgisi
  scripts.push(renderStructuredDataAsScript(generateStoreStructuredData(tenant)));

  // Breadcrumb
  const breadcrumbs = [
    { name: 'Ana Sayfa', url: `${process.env.FRONTEND_URL}/store/${tenant.slug}` },
  ];
  scripts.push(renderStructuredDataAsScript(generateBreadcrumbStructuredData(breadcrumbs)));

  return scripts;
}
