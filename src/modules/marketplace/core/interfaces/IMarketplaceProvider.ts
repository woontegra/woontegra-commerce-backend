/**
 * Core Marketplace Provider Interface
 *
 * Her pazaryeri bu interface'i implement eder.
 * Core katmanı hiçbir zaman pazaryeri API detayı bilmez.
 *
 * Yeni bir pazaryeri eklemek için:
 *   1. Bu interface'i implement eden bir Provider yaz
 *   2. MarketplaceFactory'e ekle
 *   3. Bitti — tüm sistem otomatik çalışır
 */

// ─── Credential ──────────────────────────────────────────────────────────────

export interface MarketplaceCredentials {
  apiKey:    string;
  apiSecret: string;
  sellerId:  string;
  /** Provider'a özgü ekstra alanlar (token, integrationCode vs.) */
  extra?:    Record<string, string>;
}

// ─── Product ──────────────────────────────────────────────────────────────────

export interface NormalizedProduct {
  id:          string;
  barcode:     string;
  title:       string;
  description: string;
  price:       number;
  listPrice:   number;
  currency:    string;
  quantity:    number;
  categoryId:  string;
  brandId:     string | number;
  images:      string[];
  attributes:  Record<string, any>;
  variants?:   NormalizedVariant[];
  vatRate?:    number;
  cargoCompanyId?:  number;
  deliveryDuration?: number;
}

export interface NormalizedVariant {
  barcode:    string;
  price:      number;
  listPrice:  number;
  quantity:   number;
  attributes: Record<string, any>;
}

export interface SendResult {
  success:        boolean;
  batchId?:       string;
  sentCount?:     number;
  failedCount?:   number;
  errors?:        SendError[];
  rawResponse?:   any;
}

export interface SendError {
  productId?:  string;
  barcode?:    string;
  message:     string;
  code?:       string;
}

// ─── Stock & Price ────────────────────────────────────────────────────────────

export interface StockPriceItem {
  barcode:   string;
  quantity:  number;
  listPrice: number;
  salePrice: number;
}

export interface UpdateResult {
  success:   boolean;
  updated?:  number;
  failed?:   number;
  errors?:   SendError[];
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export interface FetchOrdersOptions {
  startDate?: Date;
  endDate?:   Date;
  status?:    string;
  page?:      number;
  size?:      number;
}

export interface NormalizedOrder {
  externalId:    string;                 // Pazaryerindeki sipariş numarası
  status:        string;
  totalPrice:    number;
  currency:      string;
  orderDate:     Date;
  customerName?: string;
  customerEmail?: string;
  shipmentAddress?: Record<string, any>;
  invoiceAddress?:  Record<string, any>;
  cargoTrackingNumber?: string;
  items:         NormalizedOrderItem[];
  rawPayload:    any;                    // Ham pazaryeri verisi (loglama için)
}

export interface NormalizedOrderItem {
  externalLineId?: string;
  barcode:         string;
  productName:     string;
  quantity:        number;
  price:           number;
  merchantSku?:    string;
}

// ─── Connection test ─────────────────────────────────────────────────────────

export interface ConnectionTestResult {
  ok:       boolean;
  message?: string;
  latencyMs?: number;
}

// ─── Provider Interface ───────────────────────────────────────────────────────

export interface IMarketplaceProvider {

  /** Pazaryeri adı (loglama ve hata mesajları için) */
  readonly name: string;

  /** API bağlantısını test et */
  testConnection(): Promise<ConnectionTestResult>;

  /** Ürün gönder (yeni: POST, mevcutsa: PUT) */
  sendProducts(products: NormalizedProduct[]): Promise<SendResult>;

  /** Stok ve fiyat güncelle */
  updateStockAndPrice(items: StockPriceItem[]): Promise<UpdateResult>;

  /** Siparişleri çek */
  fetchOrders(opts?: FetchOrdersOptions): Promise<NormalizedOrder[]>;
}

// ─── Provider config ─────────────────────────────────────────────────────────

export interface ProviderConfig {
  credentials: MarketplaceCredentials;
  tenantId:    string;
}
