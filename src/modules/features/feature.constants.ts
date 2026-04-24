/**
 * Central registry of all feature flags.
 * Never hardcode feature keys outside this file.
 */
export const FEATURES = {
  // ── Core Commerce (Starter) ───────────────────────────────────────────────
  CAMPAIGNS:          'campaigns',          // basic: PRODUCT_DISCOUNT + CART_DISCOUNT
  COUPONS:            'coupons',
  BULK_IMPORT:        'bulk_import',
  SEO_TOOLS:          'seo_tools',
  BLOG:               'blog',
  EXPORT_REPORTS:     'export_reports',

  // ── Advanced Commerce (Pro) ───────────────────────────────────────────────
  ORDER:              'order',
  CUSTOMER:           'customer',
  STOCK_MANAGEMENT:   'stock_management',
  CAMPAIGN_ADVANCED:  'campaign_advanced',  // BUY_X_GET_Y + BULK_DISCOUNT
  DISCOUNT_RULES:     'discount_rules',
  ABANDONED_CART:     'abandoned_cart',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  MULTI_CURRENCY:     'multi_currency',
  TRENDYOL:           'trendyol',

  // ── Enterprise ────────────────────────────────────────────────────────────
  MARKETPLACE:        'marketplace',
  API_ACCESS:         'api_access',
  WEBHOOKS:           'webhooks',
  B2B:                'b2b',
  PAGES_BUILDER:      'pages_builder',
} as const;

export type FeatureKey = typeof FEATURES[keyof typeof FEATURES];

// ── Plan → included features ─────────────────────────────────────────────────

export const PLAN_FEATURES: Record<string, FeatureKey[]> = {
  STARTER: [
    FEATURES.CAMPAIGNS,
    FEATURES.COUPONS,
    FEATURES.BULK_IMPORT,
    FEATURES.SEO_TOOLS,
    FEATURES.BLOG,
    FEATURES.EXPORT_REPORTS,
  ],
  PRO: [
    // Includes all STARTER features
    FEATURES.CAMPAIGNS,
    FEATURES.COUPONS,
    FEATURES.BULK_IMPORT,
    FEATURES.SEO_TOOLS,
    FEATURES.BLOG,
    FEATURES.EXPORT_REPORTS,
    // Pro extras
    FEATURES.ORDER,
    FEATURES.CUSTOMER,
    FEATURES.STOCK_MANAGEMENT,
    FEATURES.CAMPAIGN_ADVANCED,
    FEATURES.DISCOUNT_RULES,
    FEATURES.ABANDONED_CART,
    FEATURES.ADVANCED_ANALYTICS,
    FEATURES.MULTI_CURRENCY,
    FEATURES.TRENDYOL,
  ],
  ENTERPRISE: [
    // Includes all PRO features
    FEATURES.CAMPAIGNS,
    FEATURES.COUPONS,
    FEATURES.BULK_IMPORT,
    FEATURES.SEO_TOOLS,
    FEATURES.BLOG,
    FEATURES.EXPORT_REPORTS,
    FEATURES.ORDER,
    FEATURES.CUSTOMER,
    FEATURES.STOCK_MANAGEMENT,
    FEATURES.CAMPAIGN_ADVANCED,
    FEATURES.DISCOUNT_RULES,
    FEATURES.ABANDONED_CART,
    FEATURES.ADVANCED_ANALYTICS,
    FEATURES.MULTI_CURRENCY,
    FEATURES.TRENDYOL,
    // Enterprise extras
    FEATURES.MARKETPLACE,
    FEATURES.API_ACCESS,
    FEATURES.WEBHOOKS,
    FEATURES.B2B,
    FEATURES.PAGES_BUILDER,
  ],
};

/** Returns the minimum plan required to access a feature */
export function getMinPlanForFeature(featureKey: FeatureKey): 'STARTER' | 'PRO' | 'ENTERPRISE' {
  if (PLAN_FEATURES.STARTER.includes(featureKey)) return 'STARTER';
  if (PLAN_FEATURES.PRO.includes(featureKey))     return 'PRO';
  return 'ENTERPRISE';
}

/** Seed data — used by startup sync and admin panel */
export const DEFAULT_FEATURES: Array<{
  key:         FeatureKey;
  name:        string;
  description: string;
  category:    string;
  defaultOn:   boolean;
}> = [
  // Core Commerce
  { key: FEATURES.CAMPAIGNS,          name: 'Kampanyalar',           description: 'Temel indirim kampanyaları (ürüne ve sepete indirim)',       category: 'commerce',    defaultOn: true  },
  { key: FEATURES.COUPONS,            name: 'Kuponlar',              description: 'İndirim kuponu oluşturma ve yönetimi',                       category: 'commerce',    defaultOn: true  },
  { key: FEATURES.BULK_IMPORT,        name: 'Toplu İçe Aktarma',    description: 'XML/CSV ile ürün ve müşteri toplu yükleme',                  category: 'operations',  defaultOn: true  },
  { key: FEATURES.SEO_TOOLS,          name: 'SEO Araçları',          description: 'Meta tag yönetimi ve site haritası',                         category: 'storefront',  defaultOn: true  },
  { key: FEATURES.BLOG,               name: 'Blog',                  description: 'Blog ve içerik yönetim sistemi',                             category: 'storefront',  defaultOn: true  },
  { key: FEATURES.EXPORT_REPORTS,     name: 'Rapor Dışa Aktarma',   description: 'Excel/CSV/XML olarak rapor indirme',                         category: 'analytics',   defaultOn: true  },

  // Advanced Commerce
  { key: FEATURES.ORDER,              name: 'Sipariş Yönetimi',      description: 'Sipariş oluşturma, takip ve durum güncelleme',               category: 'commerce',    defaultOn: false },
  { key: FEATURES.CUSTOMER,           name: 'Müşteri Yönetimi',      description: 'Müşteri profilleri, segmentasyon ve geçmişi',                category: 'commerce',    defaultOn: false },
  { key: FEATURES.STOCK_MANAGEMENT,   name: 'Gelişmiş Stok',         description: 'Stok takibi, rezervasyon ve düşürme',                       category: 'commerce',    defaultOn: false },
  { key: FEATURES.CAMPAIGN_ADVANCED,  name: 'Gelişmiş Kampanyalar',  description: 'X Al Y Bedava, Toplu Alım İndirimi kuralları',              category: 'commerce',    defaultOn: false },
  { key: FEATURES.DISCOUNT_RULES,     name: 'İndirim Kuralları',     description: 'Koşullu otomatik indirim motoru',                           category: 'commerce',    defaultOn: false },
  { key: FEATURES.ABANDONED_CART,     name: 'Terk Edilmiş Sepet',    description: 'Sepet hatırlatma ve kurtarma akışı',                        category: 'commerce',    defaultOn: false },
  { key: FEATURES.ADVANCED_ANALYTICS, name: 'Gelişmiş Analitik',    description: 'Detaylı satış, müşteri ve ürün raporları',                  category: 'analytics',   defaultOn: false },
  { key: FEATURES.MULTI_CURRENCY,     name: 'Çoklu Para Birimi',     description: 'Birden fazla para birimi ile satış',                        category: 'storefront',  defaultOn: false },
  { key: FEATURES.TRENDYOL,           name: 'Trendyol',              description: 'Trendyol ürün/sipariş senkronizasyonu',                     category: 'integration', defaultOn: false },

  // Enterprise
  { key: FEATURES.MARKETPLACE,        name: 'Pazaryeri',             description: 'Trendyol, Hepsiburada, N11 çoklu entegrasyon',              category: 'integration', defaultOn: false },
  { key: FEATURES.API_ACCESS,         name: 'API Erişimi',           description: 'REST API token oluşturma ve kullanımı',                     category: 'operations',  defaultOn: false },
  { key: FEATURES.WEBHOOKS,           name: 'Webhooklar',             description: 'Olay tabanlı dış sistem entegrasyonu',                      category: 'operations',  defaultOn: false },
  { key: FEATURES.B2B,                name: 'B2B Portalı',           description: 'Kurumsal müşteri profilleri ve özel fiyatlar',               category: 'commerce',    defaultOn: false },
  { key: FEATURES.PAGES_BUILDER,      name: 'Sayfa Oluşturucu',      description: 'Drag & drop landing page editörü',                          category: 'storefront',  defaultOn: false },
];
