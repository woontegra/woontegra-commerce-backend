import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import crypto from 'crypto';
import FormData from 'form-data';

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

  private get multipartHeaders() {
    return {
      'Authorization': this.authHeader,
      'Accept':        'application/json',
      'User-Agent':    `${this.credentials.sellerId} - SelfIntegration`,
      'SupplierId':    String(this.credentials.sellerId),
    };
  }

  private invoiceAlreadySentMessage(): string {
    return 'Bu sipariş için fatura Trendyol\'a daha önce gönderilmiş. Trendyol panelinden mevcut fatura durumunu kontrol edin.';
  }

  private isInvoiceAlreadySent(detail: string): boolean {
    return /fatura\s+(?:önceden|daha\s+önce)\s+gönderilmiş|invoice\s+already\s+sent|already\s+uploaded|already\s+exists|zaten\s+gönderilmiş/i.test(detail);
  }

  private formatTrendyolInvoiceError(
    error: any,
    label: string,
  ): Error & { statusCode: number; trendyolStatus?: number } {
    const status = error.response?.status;
    const data   = error.response?.data;
    const detail = typeof data === 'string'
      ? data
      : (data?.message ?? data?.errors?.[0]?.message ?? data?.error?.message ?? JSON.stringify(data ?? {}));
    const detailStr = String(detail ?? '');

    if (status === 409 || this.isInvoiceAlreadySent(detailStr)) {
      return Object.assign(new Error(this.invoiceAlreadySentMessage()), {
        statusCode:     409,
        trendyolStatus: status,
      });
    }

    if (status === 404) {
      return Object.assign(
        new Error('Trendyol paketi bulunamadı. Siparişi yeniden senkronize edip tekrar deneyin.'),
        { statusCode: 404, trendyolStatus: status },
      );
    }

    if (status === 403) {
      return Object.assign(
        new Error('Bu paket belirtilen satıcıya ait değil.'),
        { statusCode: 403, trendyolStatus: status },
      );
    }

    if (status === 401) {
      return Object.assign(
        new Error('Trendyol API yetkilendirme hatası. Entegrasyon bilgilerinizi kontrol edin.'),
        { statusCode: 401, trendyolStatus: status },
      );
    }

    if (status === 400) {
      if (/micro|mikro|invoice information is required/i.test(detailStr)) {
        return Object.assign(
          new Error('Mikro ihracat siparişi için fatura no ve fatura tarihi zorunludur.'),
          { statusCode: 422, trendyolStatus: status },
        );
      }
      if (/file size|10\s*mb/i.test(detailStr)) {
        return Object.assign(
          new Error('Fatura dosyası en fazla 10 MB olabilir.'),
          { statusCode: 422, trendyolStatus: status },
        );
      }
      if (/file type|not supported|pdf/i.test(detailStr)) {
        return Object.assign(
          new Error('Geçersiz dosya formatı. Sadece PDF yükleyebilirsiniz.'),
          { statusCode: 422, trendyolStatus: status },
        );
      }
      if (/file not sent|select the invoice file/i.test(detailStr)) {
        return Object.assign(
          new Error('PDF fatura dosyası seçilmedi.'),
          { statusCode: 422, trendyolStatus: status },
        );
      }

      const message = detailStr && detailStr !== '{}'
        ? detailStr
        : `Trendyol ${label} gönderilemedi. Lütfen sipariş bilgilerini kontrol edip tekrar deneyin.`;
      return Object.assign(new Error(message), { statusCode: 422, trendyolStatus: status });
    }

    if (status && status >= 400 && status < 500) {
      const message = detailStr && detailStr !== '{}'
        ? detailStr
        : `Trendyol ${label} gönderilemedi (${status}): ${error.message}`;
      return Object.assign(new Error(message), { statusCode: 422, trendyolStatus: status });
    }

    const message = detailStr && detailStr !== '{}'
      ? `Trendyol ${label} gönderilemedi: ${detailStr}`
      : `Trendyol ${label} gönderilemedi (${status ?? 'NET'}): ${error.message}`;
    return Object.assign(new Error(message), {
      statusCode:     status && status >= 500 ? 502 : 502,
      trendyolStatus: status,
    });
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

  /**
   * Trendyol stok/fiyat güncelleme — resmi endpoint:
   * POST /integration/inventory/sellers/{sellerId}/products/price-and-inventory
   * (PUT + /integration/product/... yolu 404 döner)
   */
  async updateStockAndPrice(updates: Array<{
    barcode: string;
    quantity: number;
    price: number;
    listPrice?: number;
  }>): Promise<{ batchRequestId?: string; id?: string }> {
    const url = `https://apigw.trendyol.com/integration/inventory/sellers/${this.credentials.sellerId}/products/price-and-inventory`;

    console.log(`[TrendyolClient] ── updateStockAndPrice (POST) ${updates.length} barkod ──`);
    console.log('[TrendyolClient] URL:', url);

    try {
      const response = await axios.post(url, {
        items: updates.map(update => {
          const item: Record<string, unknown> = {
            barcode:   update.barcode,
            quantity:  Math.max(0, Math.round(update.quantity)),
            salePrice: update.price,
          };
          if (update.listPrice != null && update.listPrice > 0) {
            item.listPrice = update.listPrice;
          }
          return item;
        }),
      }, { headers: this.commonHeaders, timeout: 60_000 });

      console.log('[TrendyolClient] ✅ price-and-inventory', response.status, JSON.stringify(response.data));
      return response.data ?? {};
    } catch (error: any) {
      const status = error.response?.status;
      const data   = error.response?.data;
      const detail = typeof data === 'string'
        ? data
        : (data?.message ?? data?.errors?.[0]?.message ?? JSON.stringify(data ?? {}));
      console.error('[TrendyolClient] ❌ price-and-inventory', status, detail);

      if (status === 404) {
        throw new Error(
          'Trendyol fiyat/stok endpoint bulunamadı (404). Barkod Trendyol\'da kayıtlı olmayabilir — önce Ürün Gönderme ile ürünü oluşturun.',
        );
      }
      throw new Error(`Fiyat/stok güncelleme başarısız (${status ?? 'NET'}): ${detail || error.message}`);
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

  /**
   * Trendyol fatura linki gönderimi — sendInvoiceLink
   * POST /integration/sellers/{sellerId}/seller-invoice-links
   */
  async sendInvoiceLink(payload: {
    shipmentPackageId: number;
    invoiceLink:       string;
    invoiceNumber?:    string;
    invoiceDateTime?:  number;
  }): Promise<void> {
    const url = `https://apigw.trendyol.com/integration/sellers/${this.credentials.sellerId}/seller-invoice-links`;

    const body: Record<string, unknown> = {
      shipmentPackageId: payload.shipmentPackageId,
      invoiceLink:       payload.invoiceLink,
    };
    if (payload.invoiceNumber?.trim()) {
      body.invoiceNumber = payload.invoiceNumber.trim();
    }
    if (payload.invoiceDateTime != null) {
      body.invoiceDateTime = payload.invoiceDateTime;
    }

    try {
      await axios.post(url, body, {
        headers: this.commonHeaders,
        timeout: 30_000,
      });
    } catch (error: any) {
      throw this.formatTrendyolInvoiceError(error, 'fatura linki');
    }
  }

  /**
   * Trendyol fatura dosyası yükleme — uploadInvoiceFile
   * POST /integration/sellers/{sellerId}/seller-invoice-file
   */
  async uploadInvoiceFile(payload: {
    shipmentPackageId: number;
    file:              { buffer: Buffer; originalname: string; mimetype: string };
    invoiceNumber?:    string;
    invoiceDateTime?:  number;
  }): Promise<void> {
    const url = `https://apigw.trendyol.com/integration/sellers/${this.credentials.sellerId}/seller-invoice-file`;

    const form = new FormData();
    form.append('shipmentPackageId', String(payload.shipmentPackageId));
    form.append('file', payload.file.buffer, {
      filename:    payload.file.originalname || 'invoice.pdf',
      contentType: payload.file.mimetype || 'application/pdf',
    });
    if (payload.invoiceNumber?.trim()) {
      form.append('invoiceNumber', payload.invoiceNumber.trim());
    }
    if (payload.invoiceDateTime != null) {
      form.append('invoiceDateTime', String(payload.invoiceDateTime));
    }

    try {
      await axios.post(url, form, {
        headers: {
          ...this.multipartHeaders,
          ...form.getHeaders(),
        },
        timeout:           60_000,
        maxBodyLength:     Infinity,
        maxContentLength:  Infinity,
      });
    } catch (error: any) {
      throw this.formatTrendyolInvoiceError(error, 'fatura dosyası');
    }
  }

  // COMMON LABEL — kargo etiketi (createCommonLabel + getCommonLabel)
  private formatTrendyolCargoLabelError(error: any): Error & { statusCode: number; trendyolStatus?: number } {
    const status = error.response?.status;
    const data   = error.response?.data;
    const detail = typeof data === 'string'
      ? data
      : (data?.message ?? data?.error?.message ?? data?.errors?.[0]?.message ?? JSON.stringify(data ?? {}));

    let message: string;
    let statusCode: number;

    if (status === 400) {
      message = detail && detail !== '{}'
        ? `Trendyol: ${detail}`
        : 'Kargo takip numarası geçersiz veya etiket henüz oluşturulmamış. Siparişi senkronize edip tekrar deneyin.';
      statusCode = 422;
    } else if (status === 404) {
      message = 'Trendyol kargo etiketi bulunamadı. Önce etiket talebi oluşturulmalı.';
      statusCode = 422;
    } else if (status === 403) {
      message = 'Bu sipariş için Trendyol common label desteklenmiyor. Kargo firması/modeli uygun olmayabilir.';
      statusCode = 422;
    } else if (status === 401) {
      message = 'Trendyol API yetkilendirme hatası. Entegrasyon bilgilerinizi kontrol edin.';
      statusCode = 401;
    } else {
      message = detail && detail !== '{}'
        ? `Trendyol kargo etiketi alınamadı: ${detail}`
        : `Trendyol kargo etiketi alınamadı (${status ?? 'NET'}): ${error.message}`;
      statusCode = status && status >= 400 && status < 500 ? status : 502;
    }

    return Object.assign(new Error(message), { statusCode, trendyolStatus: status });
  }

  /**
   * Ortak etiket barkod talebi — createCommonLabel
   * POST /integration/sellers/{sellerId}/common-label/{cargoTrackingNumber}
   */
  async createCommonLabel(cargoTrackingNumber: string): Promise<void> {
    const tracking = encodeURIComponent(cargoTrackingNumber);
    const url = `https://apigw.trendyol.com/integration/sellers/${this.credentials.sellerId}/common-label/${tracking}`;

    try {
      await axios.post(url, { format: 'ZPL' }, {
        headers: this.commonHeaders,
        timeout: 30_000,
      });
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 409) return;
      throw this.formatTrendyolCargoLabelError(error);
    }
  }

  /**
   * Ortak etiket alma — getCommonLabel
   * GET /integration/sellers/{sellerId}/common-label/{cargoTrackingNumber}
   */
  async getCommonLabel(cargoTrackingNumber: string): Promise<Array<{ format: string; label: string }>> {
    const tracking = encodeURIComponent(cargoTrackingNumber);
    const url = `https://apigw.trendyol.com/integration/sellers/${this.credentials.sellerId}/common-label/${tracking}`;

    try {
      const response = await axios.get(url, {
        headers: this.commonHeaders,
        timeout: 30_000,
      });
      const data = response.data?.data;
      if (!Array.isArray(data)) return [];
      return data.map((item: any) => ({
        format: String(item.format ?? 'ZPL'),
        label:  String(item.label ?? ''),
      })).filter(item => item.label);
    } catch (error: any) {
      throw this.formatTrendyolCargoLabelError(error);
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

  // CUSTOMER Q&A — ürün soruları (Trendyol Q&A Integration)
  private formatTrendyolQuestionError(error: any): Error & { statusCode: number; trendyolStatus?: number } {
    const status = error.response?.status;
    const data   = error.response?.data;
    const detail = typeof data === 'string'
      ? data
      : (data?.message ?? data?.error?.message ?? data?.errors?.[0]?.message ?? JSON.stringify(data ?? {}));

    let message: string;
    let statusCode: number;

    if (status === 401 || status === 403) {
      message = 'Trendyol API yetkilendirme hatası. Entegrasyon bilgilerinizi kontrol edin.';
      statusCode = status;
    } else if (status === 404) {
      message = 'Trendyol sorusu bulunamadı.';
      statusCode = 404;
    } else if (status === 400) {
      message = detail && detail !== '{}'
        ? `Trendyol: ${detail}`
        : 'Geçersiz soru isteği.';
      statusCode = 422;
    } else {
      message = detail && detail !== '{}'
        ? `Trendyol müşteri sorusu hatası: ${detail}`
        : `Trendyol müşteri sorusu hatası (${status ?? 'NET'}): ${error.message}`;
      statusCode = status && status >= 400 && status < 500 ? status : 502;
    }

    return Object.assign(new Error(message), { statusCode, trendyolStatus: status });
  }

  /**
   * Müşteri sorularını filtrele — GET .../qna/sellers/{sellerId}/questions/filter
   */
  async getCustomerQuestions(filter: TrendyolQuestionFilter = {}): Promise<TrendyolQuestionListResult> {
    const sellerId = this.credentials.sellerId;
    const url = `https://apigw.trendyol.com/integration/qna/sellers/${sellerId}/questions/filter`;

    const params: Record<string, string | number> = {
      supplierId: sellerId,
      page:       filter.page ?? 0,
      size:       Math.min(filter.size ?? 50, 50),
      orderByField:     filter.orderByField ?? 'CreatedDate',
      orderByDirection: filter.orderByDirection ?? 'DESC',
    };

    if (filter.barcode)   params.barcode   = filter.barcode;
    if (filter.startDate) params.startDate = filter.startDate;
    if (filter.endDate)   params.endDate   = filter.endDate;
    if (filter.status)    params.status    = filter.status;

    try {
      const response = await axios.get(url, {
        headers: this.commonHeaders,
        params,
        timeout: 30_000,
      });
      const data = response.data ?? {};
      const content: unknown[] = Array.isArray(data.content) ? data.content : [];

      return {
        content,
        page:          Number(data.page ?? filter.page ?? 0),
        size:          Number(data.size ?? filter.size ?? 50),
        totalElements: Number(data.totalElements ?? content.length),
        totalPages:    Number(data.totalPages ?? 1),
      };
    } catch (error: any) {
      throw this.formatTrendyolQuestionError(error);
    }
  }

  /**
   * Soru detayı — GET .../qna/sellers/{sellerId}/questions/{id}
   */
  async getCustomerQuestion(questionId: string | number): Promise<unknown> {
    const sellerId = this.credentials.sellerId;
    const id       = encodeURIComponent(String(questionId));
    const url      = `https://apigw.trendyol.com/integration/qna/sellers/${sellerId}/questions/${id}`;

    try {
      const response = await axios.get(url, {
        headers: this.commonHeaders,
        timeout: 30_000,
      });
      return response.data ?? {};
    } catch (error: any) {
      throw this.formatTrendyolQuestionError(error);
    }
  }

  /**
   * Soruyu cevapla — POST .../qna/sellers/{sellerId}/questions/{id}/answers
   */
  async answerCustomerQuestion(questionId: string | number, text: string): Promise<void> {
    const sellerId = this.credentials.sellerId;
    const id       = encodeURIComponent(String(questionId));
    const url      = `https://apigw.trendyol.com/integration/qna/sellers/${sellerId}/questions/${id}/answers`;

    try {
      await axios.post(url, { text }, {
        headers: this.commonHeaders,
        timeout: 30_000,
      });
    } catch (error: any) {
      throw this.formatTrendyolQuestionError(error);
    }
  }
}

export interface TrendyolQuestionFilter {
  page?:             number;
  size?:             number;
  barcode?:          string;
  startDate?:        number;
  endDate?:          number;
  status?:           string;
  orderByField?:     string;
  orderByDirection?: 'ASC' | 'DESC';
}

export interface TrendyolQuestionListResult {
  content:         unknown[];
  page:            number;
  size:            number;
  totalElements:   number;
  totalPages:      number;
}
