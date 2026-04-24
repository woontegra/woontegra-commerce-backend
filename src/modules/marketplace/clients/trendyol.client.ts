import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import crypto from 'crypto';

export interface TrendyolCredentials {
  apiKey: string;
  apiSecret: string;
  sellerId: string;
}

export interface TrendyolProduct {
  barcode: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  quantity: number;
  categoryId: string;
  brandId: string;
  images: string[];
  attributes: Record<string, any>;
  variantAttributes?: Record<string, any>[];
}

export interface TrendyolOrder {
  id: string;
  status: string;
  customerEmail: string;
  customerName: string;
  totalAmount: number;
  currency: string;
  items: TrendyolOrderItem[];
  shippingAddress: any;
  billingAddress: any;
  createdAt: string;
}

export interface TrendyolOrderItem {
  barcode: string;
  quantity: number;
  price: number;
  productName: string;
}

export interface TrendyolCategory {
  id: string;
  name: string;       // leaf name only (e.g. "Altın Bileklik")
  path: string;       // full breadcrumb (e.g. "Aksesuar / Takı & Mücevher / Bileklik / Altın Bileklik")
  parentId?: string;
  level: number;
}

/** Recursively flatten a Trendyol nested category tree into a flat list with full breadcrumb paths */
function flattenCategoryTree(
  nodes: any[],
  parentPath = '',
  depth = 0,
): TrendyolCategory[] {
  const result: TrendyolCategory[] = [];
  for (const node of nodes ?? []) {
    const leafName = String(node.name ?? '');
    const path     = parentPath ? `${parentPath} / ${leafName}` : leafName;
    result.push({
      id:       String(node.id),
      name:     leafName,
      path,
      parentId: node.parentId != null ? String(node.parentId) : undefined,
      level:    depth,
    });
    if (Array.isArray(node.subCategories) && node.subCategories.length > 0) {
      result.push(...flattenCategoryTree(node.subCategories, path, depth + 1));
    }
  }
  return result;
}

export interface TrendyolAttribute {
  id:          string;
  name:        string;
  type:        'text' | 'number' | 'boolean' | 'select';
  required:    boolean;
  allowCustom?: boolean;
  /**
   * varianter=true → this attribute is used for product variants (e.g. Color, Size).
   * It is NOT required for non-variant products even if required=true.
   */
  varianter?:  boolean;
  /** slicer=true → used as a filter/facet on Trendyol listing pages */
  slicer?:     boolean;
  /** Selectable values for this attribute (from attributeValues[].name) */
  options?: string[];
  /** Raw attribute value objects { id, name } */
  attributeValues?: { id: number | string; name: string }[];
}

export class TrendyolClient {
  private api: AxiosInstance;
  private credentials: TrendyolCredentials;

  constructor(credentials: TrendyolCredentials) {
    this.credentials = credentials;
    this.api = axios.create({
      baseURL: 'https://api.trendyol.com/sapigw/suppliers',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64')}`,
      },
    });

    // Request interceptor for logging
    this.api.interceptors.request.use(
      (config) => {
        console.log(`Trendyol API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('Trendyol API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor — preserve original Axios error so callers can read error.response.data
    this.api.interceptors.response.use(
      (response) => response,
      (error) => {
        const msg = this.formatErrorMessage(error);
        console.error('Trendyol API Error:', msg);
        // Attach a human-readable message but keep the original Axios error intact
        error.trendyolMessage = msg;
        return Promise.reject(error);
      }
    );
  }

  private formatErrorMessage(error: any): string {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      switch (status) {
        case 401:
          return 'Trendyol API authentication failed. Please check your API credentials.';
        case 403:
          return 'Access forbidden. Check your API permissions.';
        case 404:
          return 'Resource not found on Trendyol.';
        case 429:
          return 'Rate limit exceeded. Please try again later.';
        case 500:
          return 'Trendyol server error. Please try again later.';
        default:
          return data?.message || `Trendyol API error: ${status}`;
      }
    }
    
    return error.message || 'Unknown Trendyol API error';
  }

  // ── Auth header helper ─────────────────────────────────────────────────────
  private get authHeader() {
    return `Basic ${Buffer.from(`${this.credentials.apiKey}:${this.credentials.apiSecret}`).toString('base64')}`;
  }

  private get commonHeaders() {
    return {
      'Authorization': this.authHeader,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'User-Agent':    `${this.credentials.sellerId} - SelfIntegration`,
      'SupplierId':    String(this.credentials.sellerId),
    };
  }

  // CATEGORIES — official Trendyol Integration Gateway (apigw)
  // PROD:  https://apigw.trendyol.com/integration/product/product-categories
  // STAGE: https://stageapigw.trendyol.com/integration/product/product-categories
  async getCategories(): Promise<TrendyolCategory[]> {
    try {
      const response = await axios.get(
        'https://apigw.trendyol.com/integration/product/product-categories',
        { headers: this.commonHeaders, timeout: 30_000 },
      );
      const data = response.data;
      // API returns nested tree: { categories: [{...subCategories:[...]}] } or bare array
      const roots = Array.isArray(data) ? data : (data?.categories ?? data?.items ?? []);
      // Flatten the entire nested tree into a searchable flat list with full breadcrumb paths
      return flattenCategoryTree(roots);
    } catch (error: any) {
      const msg = error.response?.data?.message ?? error.message ?? 'Bilinmeyen hata';
      throw new Error(`Trendyol kategorileri alınamadı: ${msg}`);
    }
  }

  async getCategoryAttributes(categoryId: string): Promise<TrendyolAttribute[]> {
    try {
      const response = await axios.get(
        `https://apigw.trendyol.com/integration/product/product-categories/${categoryId}/attributes`,
        { headers: this.commonHeaders, timeout: 30_000 },
      );
      const data = response.data;

      // Trendyol API returns:
      // { categoryAttributes: [{ attribute: { id, name }, required, allowCustom, attributeValues: [{ id, name }] }] }
      const rawList: any[] = Array.isArray(data)
        ? data
        : (data?.categoryAttributes ?? data?.attributes ?? []);

      return rawList.map((item: any): TrendyolAttribute => {
        // Handle both nested { attribute: { id, name } } and flat { id, name } formats
        const attr   = item.attribute ?? item;
        const values: { id: number | string; name: string }[] =
          item.attributeValues ?? item.values ?? [];

        return {
          id:              String(attr.id ?? item.id ?? ''),
          name:            String(attr.name ?? item.name ?? ''),
          required:        Boolean(item.required ?? false),
          allowCustom:     Boolean(item.allowCustom ?? false),
          varianter:       Boolean(item.varianter ?? false),
          slicer:          Boolean(item.slicer ?? false),
          type:            values.length > 0 ? 'select' : 'text',
          options:         values.map((v: any) => String(v.name)),
          attributeValues: values.map((v: any) => ({ id: v.id, name: String(v.name) })),
        };
      });
    } catch (error: any) {
      const msg = error.response?.data?.message ?? error.message ?? 'Bilinmeyen hata';
      throw new Error(`Kategori özellikleri alınamadı: ${msg}`);
    }
  }

  // PRODUCTS
  /**
   * Create product(s) via Trendyol v2 API.
   * Accepts either a single product item or an array; always wraps in { items: [...] }.
   * Returns { batchRequestId } on success.
   */
  async createProduct(product: TrendyolProduct | TrendyolProduct[]): Promise<{ batchRequestId?: string; id?: string }> {
    const items = Array.isArray(product) ? product : [product];
    const url = `https://apigw.trendyol.com/integration/product/sellers/${this.credentials.sellerId}/products`;

    console.log(`[TrendyolClient] ── createProduct (POST) ${items.length} ürün ──`);
    console.log('[TrendyolClient] URL:', url);

    try {
      const response = await axios.post(url, { items }, {
        headers: this.commonHeaders,
        timeout: 60_000,
      });
      console.log('[TrendyolClient] ✅ HTTP', response.status, '| Response:', JSON.stringify(response.data));
      return response.data ?? {};
    } catch (err: any) {
      console.error('[TrendyolClient] ❌ HTTP', err?.response?.status, '| Error:', JSON.stringify(err?.response?.data ?? err?.message));
      throw err;
    }
  }

  /**
   * Update existing product(s) via Trendyol v2 API.
   * Uses PUT — same payload as createProduct but for already-existing products.
   */
  async updateProducts(items: TrendyolProduct[]): Promise<{ batchRequestId?: string; id?: string }> {
    const url = `https://apigw.trendyol.com/integration/product/sellers/${this.credentials.sellerId}/products`;

    console.log(`[TrendyolClient] ── updateProducts (PUT) ${items.length} ürün ──`);
    console.log('[TrendyolClient] URL:', url);

    try {
      const response = await axios.put(url, { items }, {
        headers: this.commonHeaders,
        timeout: 60_000,
      });
      console.log('[TrendyolClient] ✅ HTTP', response.status, '| Response:', JSON.stringify(response.data));
      return response.data ?? {};
    } catch (err: any) {
      console.error('[TrendyolClient] ❌ HTTP', err?.response?.status, '| Error:', JSON.stringify(err?.response?.data ?? err?.message));
      throw err;
    }
  }

  /** Check the async processing result of a product batch on Trendyol */
  async getBatchRequestStatus(batchRequestId: string): Promise<any> {
    const url = `https://apigw.trendyol.com/integration/product/sellers/${this.credentials.sellerId}/products/batch-requests/${batchRequestId}`;
    const response = await axios.get(url, { headers: this.commonHeaders, timeout: 15_000 });
    return response.data;
  }

  async updateProduct(barcode: string, product: Partial<TrendyolProduct>): Promise<void> {
    try {
      await this.api.put(`/${this.credentials.sellerId}/products/${barcode}`, product);
    } catch (error) {
      throw new Error(`Failed to update product: ${error.message}`);
    }
  }

  async getProduct(barcode: string): Promise<TrendyolProduct> {
    try {
      const response = await this.api.get(`/${this.credentials.sellerId}/products/${barcode}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch product: ${error.message}`);
    }
  }

  async deleteProduct(barcode: string): Promise<void> {
    try {
      await this.api.delete(`/${this.credentials.sellerId}/products/${barcode}`);
    } catch (error) {
      throw new Error(`Failed to delete product: ${error.message}`);
    }
  }

  async updateStockAndPrice(updates: Array<{
    barcode: string;
    quantity: number;
    price: number;
  }>): Promise<void> {
    const url = `https://apigw.trendyol.com/integration/product/sellers/${this.credentials.sellerId}/products/price-and-inventory`;
    try {
      await axios.put(url, {
        items: updates.map(update => ({
          barcode:   update.barcode,
          quantity:  update.quantity,
          salePrice: update.price,
        })),
      }, { headers: this.commonHeaders, timeout: 30_000 });
    } catch (error: any) {
      const msg = error.response?.data?.message ?? error.message ?? 'Trendyol fiyat/stok güncelleme hatası';
      throw new Error(`Fiyat/stok güncelleme başarısız: ${msg}`);
    }
  }

  // ORDERS — uses the Integration Gateway (apigw), not the old sapigw endpoint
  async getOrders(opts: {
    startDate?: number;  // Unix ms
    endDate?:   number;  // Unix ms
    status?:    string;  // "Created,Picking,Invoiced,Shipped" etc.
    page?:      number;
    size?:      number;
  } = {}): Promise<any[]> {
    const { startDate, endDate, status = 'Created,Picking,Invoiced', page = 0, size = 200 } = opts;

    const params: Record<string, any> = { status, page, size };
    if (startDate) params.startDate = startDate;
    if (endDate)   params.endDate   = endDate;

    const url = `https://apigw.trendyol.com/integration/order/sellers/${this.credentials.sellerId}/orders`;
    try {
      const response = await axios.get(url, {
        headers: this.commonHeaders,
        params,
        timeout: 30_000,
      });
      // Response: { content: [], totalPages, totalElements, size, page }
      return response.data?.content ?? [];
    } catch (error: any) {
      const msg = error.response?.data?.message ?? error.message ?? 'Trendyol sipariş çekme hatası';
      throw new Error(`Sipariş çekilemedi: ${msg}`);
    }
  }

  async getOrder(orderId: string): Promise<TrendyolOrder> {
    try {
      const response = await this.api.get(`/${this.credentials.sellerId}/orders/${orderId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch order: ${error.message}`);
    }
  }

  async updateOrderStatus(orderId: string, status: string, trackingNumber?: string): Promise<void> {
    try {
      const data: any = { status };
      if (trackingNumber) {
        data.trackingNumber = trackingNumber;
      }
      await this.api.put(`/${this.credentials.sellerId}/orders/${orderId}/status`, data);
    } catch (error) {
      throw new Error(`Failed to update order status: ${error.message}`);
    }
  }

  // BRANDS — official apigw endpoint (same pattern as categories)
  // PROD:  https://apigw.trendyol.com/integration/product/brands
  // STAGE: https://stageapigw.trendyol.com/integration/product/brands
  async getBrands(search?: string): Promise<Array<{ id: number; name: string }>> {
    const params: Record<string, string> = {};
    if (search?.trim()) params.name = search.trim();
    const response = await axios.get(
      'https://apigw.trendyol.com/integration/product/brands',
      { headers: this.commonHeaders, params, timeout: 15_000 },
    );
    const raw = response.data;
    // Response is either an array or { brands: [...] }
    const list: any[] = Array.isArray(raw) ? raw : (raw?.brands ?? raw?.content ?? []);
    return list.map(b => ({ id: Number(b.id), name: String(b.name) }));
  }

  /** Create a new brand on Trendyol — POST /integration/product/brands */
  async createBrand(name: string): Promise<{ id: number; name: string }> {
    const response = await axios.post(
      'https://apigw.trendyol.com/integration/product/brands',
      { name },
      { headers: this.commonHeaders, timeout: 15_000 },
    );
    const raw = response.data;
    return { id: Number(raw?.id ?? raw?.brandId ?? 0), name: String(raw?.name ?? name) };
  }

  // HEALTH CHECK — verify credentials by hitting the official categories endpoint
  async healthCheck(): Promise<boolean> {
    try {
      await axios.get(
        'https://apigw.trendyol.com/integration/product/product-categories',
        { headers: this.commonHeaders, timeout: 10_000 },
      );
      return true;
    } catch {
      return false;
    }
  }
}
