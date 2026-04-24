/**
 * XML Import — Production Level
 *
 * Endpoints:
 *   POST /api/products/import/xml/preview  — parse file, return detected fields + samples
 *   POST /api/products/import/xml          — import with custom field mapping + duplicate handling
 *   GET  /api/products/import/history      — last 20 import logs for this tenant
 */

import multer from 'multer';
import { Response } from 'express';
import { XMLParser } from 'fast-xml-parser';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import prisma from '../../config/database';
import { generateUniqueProductSlug, generateSEOSlug } from '../../common/utils/slug.utils';
import { searchService, toProductDocument } from '../search/search.service';
import https from 'https';
import http from 'http';

// ─── Multer ────────────────────────────────────────────────────────────────────

export const xmlUploader = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'text/xml'
      || file.mimetype === 'application/xml'
      || file.originalname.toLowerCase().endsWith('.xml');
    ok ? cb(null, true) : cb(new Error('Sadece .xml dosyaları kabul edilir.'));
  },
}).single('file');

// ─── Target field definitions ─────────────────────────────────────────────────

export const TARGET_FIELDS: Array<{ key: string; label: string; required?: boolean }> = [
  { key: 'name',          label: 'Ürün Adı',        required: true },
  { key: 'price',         label: 'Satış Fiyatı',    required: true },
  { key: 'category',      label: 'Kategori' },
  { key: 'barcode',       label: 'Barkod' },
  { key: 'sku',           label: 'SKU / Ürün Kodu' },
  { key: 'description',   label: 'Açıklama' },
  { key: 'brand',         label: 'Marka' },
  { key: 'stock',         label: 'Stok Miktarı' },
  { key: 'discountPrice', label: 'İndirimli Fiyat' },
  { key: 'imageUrl',      label: 'Görsel URL' },
  { key: 'unit',          label: 'Birim' },
  { key: '__ignore__',    label: '— Yoksay —' },
];

// ─── Auto-suggest mapping ─────────────────────────────────────────────────────

// Normalized lookup: key is lowercased + only alphanumeric chars
const SUGGEST_NORM: Record<string, string> = {
  // name
  productname: 'name', urunadi: 'name', title: 'name', baslik: 'name', name: 'name', ad: 'name',
  // price (includes regularprice from _regular_price normalization)
  price: 'price', saleprice: 'price', fiyat: 'price', satisfiyati: 'price',
  sellprice: 'price', listprice: 'price', regularprice: 'price', normalprice: 'price',
  // discountPrice
  discountprice: 'discountPrice', discountedprice: 'discountPrice',
  indirimlifiyat: 'discountPrice', kampanyafiyat: 'discountPrice',
  // barcode
  barcode: 'barcode', barkod: 'barcode', ean: 'barcode', gtin: 'barcode', upc: 'barcode',
  // sku
  sku: 'sku', code: 'sku', productcode: 'sku', urunkodu: 'sku', kod: 'sku',
  stockcode: 'sku', postname: 'sku', wppostname: 'sku',
  // description
  description: 'description', desc: 'description', aciklama: 'description',
  summary: 'description', ozet: 'description', tanim: 'description', icerik: 'description',
  contentencoded: 'description',
  // brand
  brand: 'brand', marka: 'brand', manufacturer: 'brand', uretici: 'brand',
  // stock
  stock: 'stock', quantity: 'stock', qty: 'stock', stok: 'stock', miktar: 'stock',
  stockqty: 'stock', stockquantity: 'stock',
  // imageUrl
  imageurl: 'imageUrl', image: 'imageUrl', photo: 'imageUrl', gorsel: 'imageUrl',
  resim: 'imageUrl', thumbnail: 'imageUrl', imagelink: 'imageUrl', pictureurl: 'imageUrl',
  // unit
  unit: 'unit', birim: 'unit',
  // category
  category: 'category', kategori: 'category', categoryname: 'category',
  productcategory: 'category', cat: 'category', productcat: 'category',
};

// Direct lookup for fields that have colons, underscores or other special chars
const SUGGEST_DIRECT: Record<string, string> = {
  // WordPress/WooCommerce standard XML child fields
  'content:encoded':   'description', 'excerpt:encoded':    '__ignore__',
  'wp:post_name':      'sku',         'wp:post_status':     '__ignore__',
  'wp:post_type':      '__ignore__',  'wp:post_id':         '__ignore__',
  'wp:post_date':      '__ignore__',  'wp:post_date_gmt':   '__ignore__',
  'wp:comment_status': '__ignore__',  'wp:ping_status':     '__ignore__',
  'wp:post_parent':    '__ignore__',  'wp:menu_order':      '__ignore__',
  'wp:is_sticky':      '__ignore__',  'wp:status':          '__ignore__',
  'dc:creator':        '__ignore__',  'pubDate':            '__ignore__',
  'link':              '__ignore__',  'guid':               '__ignore__',
  // WooCommerce postmeta fields (flattened from <wp:postmeta> key-value pairs)
  '_price':            'price',       '_regular_price':     'price',
  '_sale_price':       'discountPrice','_sku':              'sku',
  '_stock':            'stock',       '_stock_quantity':    'stock',
  '_manage_stock':     '__ignore__',  '_weight':            '__ignore__',
  '_length':           '__ignore__',  '_width':             '__ignore__',
  '_height':           '__ignore__',  '_virtual':           '__ignore__',
  '_downloadable':     '__ignore__',  '_tax_status':        '__ignore__',
  '_tax_class':        '__ignore__',  '_visibility':        '__ignore__',
  // Injected image fields (resolved from WP attachments or nested elements)
  '_image_url':        'imageUrl',   'image_url':          'imageUrl',
  '_thumbnail_url':    'imageUrl',   'thumbnail_url':      'imageUrl',
  'g:image_link':      'imageUrl',   'image_link':         'imageUrl',
  // Category (WooCommerce / Google Shopping)
  'g:google_product_category': 'category',
  'g:product_type':            'category',
};

function suggestMapping(xmlFields: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of xmlFields) {
    if (SUGGEST_DIRECT[f] !== undefined) {
      map[f] = SUGGEST_DIRECT[f];
    } else {
      const norm = f.toLowerCase().replace(/[^a-z0-9]/g, '');
      map[f] = SUGGEST_NORM[norm] ?? '__ignore__';
    }
  }
  return map;
}

// ─── XML parse helpers ────────────────────────────────────────────────────────

export type XmlFormat = 'wordpress' | 'standard';

// Unwrap fast-xml-parser wrapper values:
//   { "#text": "..." }  — element that has attributes + text content
//   [value]             — single-item array caused by isArray config
function unwrapXmlValue(val: any): any {
  if (Array.isArray(val)) {
    if (val.length === 0) return '';
    if (val.length === 1) return unwrapXmlValue(val[0]);
    return val; // multi-element array → keep (will be excluded as object)
  }
  if (val && typeof val === 'object' && !Array.isArray(val) && '#text' in val) {
    return val['#text'];
  }
  return val;
}

// Recursively find the first image URL in a nested value
function extractFirstUrl(val: any, depth = 0): string | null {
  if (depth > 6) return null;
  if (typeof val === 'string') {
    const s = val.trim();
    if (/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|avif|svg|bmp)(\?.*)?$/i.test(s)) return s;
    if (/^https?:\/\/.+\/(uploads?|images?|media|photos?|cdn|wp-content|assets?)\/.+/i.test(s)) return s;
    // Accept any HTTPS URL containing recognizable image path segments
    if (/^https?:\/\/.+(\/product[-_]?image|\/thumbnail|\/photo)\//i.test(s)) return s;
    return null;
  }
  if (Array.isArray(val)) {
    for (const v of val) { const u = extractFirstUrl(v, depth + 1); if (u) return u; }
    return null;
  }
  if (val && typeof val === 'object') {
    for (const v of Object.values(val)) { const u = extractFirstUrl(v, depth + 1); if (u) return u; }
  }
  return null;
}

// Detect WordPress/WooCommerce RSS export and return product items
// with _image_url injected from matched <wp:attachment_url> elements.
function extractWordPressItems(parsed: any): { items: any[]; isWordPress: boolean } {
  try {
    const rssRaw = parsed.rss;
    if (!rssRaw) return { items: [], isWordPress: false };
    const rss = Array.isArray(rssRaw) ? rssRaw[0] : rssRaw;
    if (!rss || typeof rss !== 'object') return { items: [], isWordPress: false };

    const channelRaw = rss.channel;
    if (!channelRaw) return { items: [], isWordPress: false };
    const channel = Array.isArray(channelRaw) ? channelRaw[0] : channelRaw;
    if (!channel || typeof channel !== 'object') return { items: [], isWordPress: false };

    // WordPress indicator
    const isWordPress =
      channel['wp:wxr_version'] !== undefined ||
      channel['wp:base_site_url'] !== undefined;
    if (!isWordPress) return { items: [], isWordPress: false };

    const itemsRaw = channel.item;
    if (!itemsRaw) return { items: [], isWordPress: true };
    const allItems: any[] = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];

    // ── Build attachment maps from <item wp:post_type="attachment"> ───────────
    // Method A: by attachment post_id (matched via _thumbnail_id postmeta)
    const attachByPostId = new Map<string, string>();   // wp:post_id → url
    // Method B: by parent product post_id (first attachment whose wp:post_parent matches)
    const attachByParent = new Map<string, string>();   // wp:post_parent → first url

    for (const item of allItems) {
      const postType = unwrapXmlValue(item?.['wp:post_type']);
      if (postType !== 'attachment') continue;
      const attachUrl = unwrapXmlValue(item?.['wp:attachment_url']);
      if (!attachUrl || typeof attachUrl !== 'string' || !attachUrl.trim()) continue;
      const url = (attachUrl as string).trim();
      const postId   = String(unwrapXmlValue(item?.['wp:post_id'])     ?? '').trim();
      const parentId = String(unwrapXmlValue(item?.['wp:post_parent']) ?? '').trim();
      if (postId)                   attachByPostId.set(postId, url);
      if (parentId && parentId !== '0' && !attachByParent.has(parentId))
        attachByParent.set(parentId, url);
    }

    // ── Filter to WooCommerce products ───────────────────────────────────────
    const hasPostType = allItems.some(it => it?.['wp:post_type'] !== undefined);
    let productItems = allItems;
    if (hasPostType) {
      const filtered = allItems.filter(it => unwrapXmlValue(it?.['wp:post_type']) === 'product');
      if (filtered.length > 0) productItems = filtered;
    }

    // ── Inject _image_url into each product item ─────────────────────────────
    if (attachByPostId.size > 0 || attachByParent.size > 0) {
      for (const item of productItems) {
        if (item._image_url) continue; // already resolved
        let imageUrl: string | undefined;

        // Method A: _thumbnail_id postmeta → attachment by post_id
        if (!imageUrl && attachByPostId.size > 0) {
          const postmeta = item['wp:postmeta'];
          const metas: any[] = Array.isArray(postmeta) ? postmeta : postmeta ? [postmeta] : [];
          for (const meta of metas) {
            const k = unwrapXmlValue(meta?.['wp:meta_key']);
            if (k === '_thumbnail_id') {
              const tid = String(unwrapXmlValue(meta?.['wp:meta_value']) ?? '').trim();
              imageUrl = attachByPostId.get(tid);
              break;
            }
          }
        }

        // Method B: product's wp:post_id → attachment by parent
        if (!imageUrl && attachByParent.size > 0) {
          const pid = String(unwrapXmlValue(item?.['wp:post_id']) ?? '').trim();
          if (pid) imageUrl = attachByParent.get(pid);
        }

        if (imageUrl) (item as any)._image_url = imageUrl;
      }
    }

    return { isWordPress: true, items: productItems };
  } catch {
    return { items: [], isWordPress: false };
  }
}

// Flatten a WordPress/WooCommerce item:
//  • copies all primitive direct fields (unwrapping { "#text":... } objects)
//  • expands wp:postmeta key→value pairs into top-level fields (e.g. _price, _sku)
function flattenWordPressItem(item: any): Record<string, string> {
  const flat: Record<string, string> = {};

  for (const [key, rawVal] of Object.entries(item)) {
    if (key === 'wp:postmeta') continue;
    if (key.startsWith('@_') || key === '#text') continue;
    const val = unwrapXmlValue(rawVal);
    if (typeof val !== 'object' || val === null) {
      flat[key] = val != null ? String(val) : '';
    }
  }

  // Expand <wp:postmeta><wp:meta_key>_price</wp:meta_key><wp:meta_value>100</wp:meta_value></wp:postmeta>
  const postmetaRaw = item['wp:postmeta'];
  const metas: any[] = Array.isArray(postmetaRaw)
    ? postmetaRaw
    : postmetaRaw && typeof postmetaRaw === 'object' ? [postmetaRaw] : [];

  for (const meta of metas) {
    if (!meta || typeof meta !== 'object') continue;
    const k = unwrapXmlValue(meta['wp:meta_key']);
    const v = unwrapXmlValue(meta['wp:meta_value']);
    if (k && typeof k === 'string' && k.trim()) {
      flat[k.trim()] = v != null ? String(v) : '';
    }
  }

  return flat;
}

// Find the largest array of plain objects in a nested structure (for standard XML)
function findLargestObjectArray(obj: any, depth = 0): any[] | null {
  if (!obj || typeof obj !== 'object' || depth > 10) return null;
  let best: any[] | null = null;

  const consider = (arr: any[]) => {
    const objItems = arr.filter(v => v && typeof v === 'object' && !Array.isArray(v));
    if (objItems.length > (best?.length ?? 0)) {
      best = objItems.length === arr.length ? arr : objItems;
    }
  };

  if (Array.isArray(obj)) {
    consider(obj);
    for (const item of obj) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const inner = findLargestObjectArray(item, depth + 1);
        if (inner && inner.length > (best?.length ?? 0)) best = inner;
      }
    }
    return best;
  }

  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      consider(val);
      const inner = findLargestObjectArray(val, depth + 1);
      if (inner && inner.length > (best?.length ?? 0)) best = inner;
    } else if (val && typeof val === 'object') {
      const inner = findLargestObjectArray(val, depth + 1);
      if (inner && inner.length > (best?.length ?? 0)) best = inner;
    }
  }
  return best;
}

// Flatten a standard XML node to a Record<string, string>.
// For complex/nested values, tries to extract a URL (for image fields like <images><image>url</image></images>).
function flattenStandardNode(item: any): Record<string, string> {
  const flat: Record<string, string> = {};
  if (!item || typeof item !== 'object' || Array.isArray(item)) return flat;
  for (const [key, rawVal] of Object.entries(item)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const val = unwrapXmlValue(rawVal);
    if (typeof val !== 'object' || val === null) {
      flat[key] = val != null ? String(val) : '';
    } else {
      // For complex nested values, try to extract an image URL (handles <images><image>url</image></images>)
      const url = extractFirstUrl(rawVal);
      if (url) flat[key] = url;
    }
  }
  return flat;
}

function parseXmlToNodes(buffer: Buffer): {
  nodes: Record<string, string>[];
  error?: string;
  xmlFormat: XmlFormat;
} {
  const parser = new XMLParser({
    ignoreAttributes:    false,
    parseAttributeValue: true,
    parseTagValue:       false,  // keep values as strings (avoids 100.00 → 100)
    trimValues:          true,
    isArray:             (_name, _jpath, isLeafNode) => !isLeafNode,
    textNodeName:        '#text',
    attributeNamePrefix: '@_',
  });

  let parsed: any;
  try {
    parsed = parser.parse(buffer.toString('utf-8'));
  } catch {
    return { nodes: [], error: 'Geçersiz XML formatı. Dosyanızı kontrol edin.', xmlFormat: 'standard' };
  }

  // ── 1. WordPress/WooCommerce RSS detection ───────────────────────────────
  const wp = extractWordPressItems(parsed);
  if (wp.isWordPress) {
    if (wp.items.length === 0) {
      return {
        nodes: [],
        error: 'WordPress XML içinde "product" tipi ürün bulunamadı. WooCommerce ürün dışa aktarması kullandığınızdan emin olun.',
        xmlFormat: 'wordpress',
      };
    }
    return { nodes: wp.items.map(flattenWordPressItem), xmlFormat: 'wordpress' };
  }

  // ── 2. Standard XML: find the largest array of objects ───────────────────
  const found = findLargestObjectArray(parsed);
  if (found && found.length > 0) {
    return { nodes: found.map(flattenStandardNode), xmlFormat: 'standard' };
  }

  // ── 3. Single-product fallback ───────────────────────────────────────────
  const rootVal = Object.values(parsed).find(v => v && typeof v === 'object');
  if (rootVal) {
    return { nodes: [flattenStandardNode(rootVal as any)], xmlFormat: 'standard' };
  }

  return {
    nodes: [],
    error: 'XML içinde ürün listesi bulunamadı. Her ürünün ayrı bir XML elementi olduğundan emin olun.',
    xmlFormat: 'standard',
  };
}

// Collect fields that appear with non-empty values across sample nodes
// Returns fields sorted by frequency (most common first)
function collectXmlFields(nodes: Record<string, string>[]): string[] {
  const counts = new Map<string, number>();
  for (const node of nodes.slice(0, 100)) {
    for (const [key, val] of Object.entries(node)) {
      if (key.startsWith('@_') || key === '#text') continue;
      if (String(val ?? '').trim()) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

function nodeToRow(node: Record<string, string>, fields: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (const f of fields) {
    row[f] = node[f] ?? '';
  }
  return row;
}

// ─── Row → product data ────────────────────────────────────────────────────────

interface MappedProduct {
  name?:          string;
  price?:         number;
  category?:      string;
  barcode?:       string;
  sku?:           string;
  description?:   string;
  brand?:         string;
  stock?:         number;
  discountPrice?: number;
  imageUrl?:      string;
  unit?:          string;
}

function applyMapping(
  node: Record<string, string>,
  mapping: Record<string, string>,
): MappedProduct {
  const result: Record<string, any> = {};

  for (const [xmlField, targetField] of Object.entries(mapping)) {
    if (targetField === '__ignore__') continue;
    const raw = node[xmlField];
    if (raw == null || String(raw).trim() === '') continue;
    const str = String(raw).trim();

    if (['price', 'discountPrice', 'stock'].includes(targetField)) {
      // Handle comma as decimal separator (European format)
      const n = parseFloat(str.replace(/[^\d.,]/g, '').replace(',', '.'));
      if (!isNaN(n) && n >= 0) result[targetField] = n;
    } else {
      result[targetField] = str;
    }
  }

  return result as MappedProduct;
}

// ─── Validation ────────────────────────────────────────────────────────────────

interface ValidationError { field: string; message: string }

function validateRow(data: MappedProduct, rowIndex: number): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!data.name || data.name.trim().length < 1) {
    errors.push({ field: 'name', message: 'Ürün adı zorunludur.' });
  } else if (data.name.trim().length > 500) {
    errors.push({ field: 'name', message: 'Ürün adı 500 karakteri geçemez.' });
  }

  if (data.price == null) {
    errors.push({ field: 'price', message: 'Satış fiyatı zorunludur.' });
  } else if (data.price < 0) {
    errors.push({ field: 'price', message: 'Fiyat negatif olamaz.' });
  }

  if (data.discountPrice != null && data.discountPrice < 0) {
    errors.push({ field: 'discountPrice', message: 'İndirimli fiyat negatif olamaz.' });
  }

  if (data.stock != null && data.stock < 0) {
    errors.push({ field: 'stock', message: 'Stok negatif olamaz.' });
  }

  if (data.barcode && !/^[A-Za-z0-9\-]{3,64}$/.test(data.barcode.trim())) {
    errors.push({ field: 'barcode', message: 'Barkod formatı geçersiz.' });
  }

  return errors;
}

// ─── Preview endpoint ─────────────────────────────────────────────────────────

export const previewXml = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: 'XML dosyası yüklenmedi.' }); return; }

    const { nodes, error, xmlFormat } = parseXmlToNodes(req.file.buffer);
    if (error) { res.status(400).json({ error }); return; }
    if (nodes.length === 0) { res.status(400).json({ error: 'XML içinde ürün bulunamadı.' }); return; }

    const xmlFields        = collectXmlFields(nodes);
    const sampleRows       = nodes.slice(0, 5).map(n => nodeToRow(n, xmlFields));
    const suggestedMapping = suggestMapping(xmlFields);

    res.json({
      status: 'success',
      data: {
        totalRows:        nodes.length,
        xmlFields,
        sampleRows,
        suggestedMapping,
        targetFields:     TARGET_FIELDS,
        filename:         req.file.originalname,
        fileSizeBytes:    req.file.size,
        xmlFormat,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Önizleme sırasında hata oluştu.' });
  }
};

// ─── Import endpoint ──────────────────────────────────────────────────────────

export type DuplicateMode = 'skip' | 'update' | 'error';

export interface ImportRowResult {
  row:        number;
  name:       string;
  barcode:    string;
  status:     'imported' | 'updated' | 'skipped' | 'error';
  errors?:    string[];
}

export const importXml = async (req: AuthRequest, res: Response): Promise<void> => {
  const startedAt = new Date();
  const tenantId  = req.user!.tenantId!;
  const userId    = req.user!.userId ?? req.user!.id;

  try {
    if (!req.file) { res.status(400).json({ error: 'XML dosyası yüklenmedi.' }); return; }

    // ── Parse mapping + options from request body ──────────────────────────
    let mapping: Record<string, string> = {};
    let duplicateMode: DuplicateMode = 'skip';

    try {
      if (req.body.mapping)       mapping       = JSON.parse(req.body.mapping);
      if (req.body.duplicateMode) duplicateMode = req.body.duplicateMode as DuplicateMode;
    } catch {
      res.status(400).json({ error: 'Geçersiz mapping JSON formatı.' });
      return;
    }

    // Ensure required fields are mapped
    const mappedTargets = Object.values(mapping).filter(v => v !== '__ignore__');
    if (!mappedTargets.includes('name')) {
      res.status(422).json({ error: 'Ürün Adı alanı eşleştirilmesi zorunludur.' });
      return;
    }
    if (!mappedTargets.includes('price')) {
      res.status(422).json({ error: 'Satış Fiyatı alanı eşleştirilmesi zorunludur.' });
      return;
    }

    // ── Parse XML ──────────────────────────────────────────────────────────
    const { nodes, error } = parseXmlToNodes(req.file.buffer);
    if (error || nodes.length === 0) {
      res.status(400).json({ error: error ?? 'XML içinde ürün bulunamadı.' });
      return;
    }

    // ── Pre-load existing barcodes for this tenant ─────────────────────────
    const existingByBarcode = new Map<string, { id: string; name: string }>();
    const existingBySku     = new Map<string, { id: string; name: string }>();

    const existingProducts = await prisma.product.findMany({
      where:  { tenantId, barcode: { not: null } },
      select: { id: true, name: true, barcode: true, sku: true },
    });
    for (const p of existingProducts) {
      if (p.barcode) existingByBarcode.set(p.barcode.trim().toLowerCase(), { id: p.id, name: p.name });
      if (p.sku)     existingBySku.set(p.sku.trim().toLowerCase(),     { id: p.id, name: p.name });
    }

    // ── Process rows ───────────────────────────────────────────────────────
    const results:     ImportRowResult[] = [];
    let   importedCnt  = 0;
    let   updatedCnt   = 0;
    let   skippedCnt   = 0;
    let   failedCnt    = 0;

    for (let i = 0; i < nodes.length; i++) {
      const row    = i + 1;
      const node   = nodes[i];
      const data   = applyMapping(node, mapping);
      const errors = validateRow(data, row);

      if (errors.length > 0) {
        results.push({
          row,
          name:    data.name ?? '—',
          barcode: data.barcode ?? '',
          status:  'error',
          errors:  errors.map(e => `${e.field}: ${e.message}`),
        });
        failedCnt++;
        continue;
      }

      // ── Duplicate detection ──────────────────────────────────────────────
      const barcodeKey  = data.barcode ? data.barcode.trim().toLowerCase() : null;
      const skuKey      = data.sku     ? data.sku.trim().toLowerCase()     : null;

      const existing =
        (barcodeKey && existingByBarcode.get(barcodeKey)) ||
        (skuKey     && existingBySku.get(skuKey))         ||
        null;

      if (existing) {
        if (duplicateMode === 'error') {
          results.push({
            row,
            name:    data.name!,
            barcode: data.barcode ?? '',
            status:  'error',
            errors:  [`Mevcut ürün ile çakışma: "${existing.name}" (barkod/SKU eşleşmesi)`],
          });
          failedCnt++;
          continue;
        }

        if (duplicateMode === 'skip') {
          results.push({
            row,
            name:    data.name!,
            barcode: data.barcode ?? '',
            status:  'skipped',
            errors:  [`Atlandı: "${existing.name}" ile barkod/SKU çakışması`],
          });
          skippedCnt++;
          continue;
        }

        // mode === 'update'
        try {
          const updateData: any = {
            name:    data.name!,
            price:   data.price!,
            ...(data.barcode       ? { barcode:     data.barcode }       : {}),
            ...(data.sku           ? { sku:         data.sku }           : {}),
            ...(data.description   ? { description: data.description }   : {}),
            ...(data.brand         ? { brand:       data.brand }         : {}),
            ...(data.unit          ? { unit:        data.unit }          : {}),
          };

          await prisma.product.update({
            where: { id: existing.id },
            data:  updateData,
          });

          // Update pricing
          await prisma.productPrice.upsert({
            where:  { productId: existing.id },
            create: { productId: existing.id, salePrice: data.price!, discountPrice: data.discountPrice ?? null, vatRate: 18, currency: 'TRY' },
            update: { salePrice: data.price!, ...(data.discountPrice != null ? { discountPrice: data.discountPrice } : {}) },
          });

          // Update stock
          if (data.stock != null) {
            await prisma.stock.upsert({
              where:  { productId: existing.id },
              create: { productId: existing.id, tenantId, quantity: data.stock, unit: data.unit ?? 'adet' },
              update: { quantity: data.stock },
            });
          }

          // Update main image URL
          if (data.imageUrl) {
            const existingImg = await prisma.productImage.findFirst({
              where: { productId: existing.id, isMain: true },
            });
            if (existingImg) {
              await prisma.productImage.update({ where: { id: existingImg.id }, data: { url: data.imageUrl } });
            } else {
              await prisma.productImage.create({
                data: { productId: existing.id, url: data.imageUrl, isMain: true, alt: data.name ?? '', order: 0 },
              });
            }
          }

          // Update barcodeKey map so later rows don't re-match same product
          if (barcodeKey) existingByBarcode.set(barcodeKey, { id: existing.id, name: data.name! });

          results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'updated' });
          updatedCnt++;
        } catch (err: any) {
          results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'error', errors: [err.message] });
          failedCnt++;
        }
        continue;
      }

      // ── Create new product ───────────────────────────────────────────────
      try {
        const slug = await generateUniqueProductSlug(data.name!, tenantId);

        const created = await prisma.product.create({
          data: {
            name:        data.name!,
            slug,
            price:       data.price!,
            barcode:     data.barcode     ?? null,
            sku:         data.sku         ?? null,
            description: data.description ?? null,
            brand:       data.brand       ?? null,
            unit:        data.unit        ?? 'adet',
            status:      'draft',
            isActive:    false,
            hasVariants: false,
            tenant:      { connect: { id: tenantId } },
            pricing: {
              create: {
                salePrice:     data.price!,
                discountPrice: data.discountPrice ?? null,
                vatRate:       18,
                currency:      'TRY',
              },
            },
          },
        });

        if (data.stock != null) {
          await prisma.stock.create({
            data: { productId: created.id, tenantId, quantity: data.stock, unit: data.unit ?? 'adet' },
          });
        }

        // Save main image URL
        if (data.imageUrl) {
          await prisma.productImage.create({
            data: { productId: created.id, url: data.imageUrl, isMain: true, alt: data.name ?? '', order: 0 },
          }).catch(() => {}); // non-blocking if image URL is invalid
        }

        // Index for search (fire-and-forget)
        prisma.product.findUnique({
          where: { id: created.id },
          include: { pricing: true, images: true, category: true, variants: true },
        }).then(p => { if (p) searchService.upsertProduct(toProductDocument(p as any)); }).catch(() => {});

        // Track barcode to prevent within-batch duplicates
        if (barcodeKey) existingByBarcode.set(barcodeKey, { id: created.id, name: created.name });
        if (skuKey)     existingBySku.set(skuKey,     { id: created.id, name: created.name });

        results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'imported' });
        importedCnt++;
      } catch (err: any) {
        results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'error', errors: [err.message] });
        failedCnt++;
      }
    }

    // ── Save ImportLog ─────────────────────────────────────────────────────
    const summary = {
      total:    nodes.length,
      imported: importedCnt,
      updated:  updatedCnt,
      skipped:  skippedCnt,
      failed:   failedCnt,
    };

    try {
      await prisma.importLog.create({
        data: {
          filename:   req.file.originalname,
          type:       'XML',
          status:     failedCnt === nodes.length ? 'failed' : failedCnt > 0 ? 'partial' : 'success',
          totalRows:  nodes.length,
          successRows: importedCnt + updatedCnt,
          failedRows: failedCnt,
          errors:     results.filter(r => r.status === 'error').slice(0, 200) as any,
          startedAt,
          completedAt: new Date(),
          createdBy:   userId,
          tenant:      { connect: { id: tenantId } },
        },
      });
    } catch { /* ImportLog failure is non-blocking */ }

    res.json({
      status:  'success',
      summary,
      results,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'XML işleme sırasında hata oluştu.' });
  }
};

// ─── URL fetch helper ─────────────────────────────────────────────────────────

const MAX_URL_BYTES = 30 * 1024 * 1024; // 30 MB

function fetchUrlAsBuffer(rawUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Basic validation
    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { return reject(new Error('Geçersiz URL formatı.')); }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return reject(new Error('Yalnızca http:// ve https:// URL\'leri desteklenir.'));
    }

    const requester = parsed.protocol === 'https:' ? https : http;
    const req = requester.get(rawUrl, { timeout: 30_000 }, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        return reject(new Error(`URL yanıtı ${res.statusCode} döndü.`));
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_URL_BYTES) {
          req.destroy();
          reject(new Error('URL içeriği 30 MB sınırını aştı.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end',   () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('URL isteği zaman aşımına uğradı.')); });
  });
}

// ─── Preview from URL endpoint ────────────────────────────────────────────────

export const previewXmlFromUrl = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url alanı zorunludur.' });
      return;
    }

    let buffer: Buffer;
    try { buffer = await fetchUrlAsBuffer(url.trim()); }
    catch (e: any) { res.status(400).json({ error: e.message }); return; }

    const { nodes, error, xmlFormat } = parseXmlToNodes(buffer);
    if (error) { res.status(400).json({ error }); return; }
    if (nodes.length === 0) { res.status(400).json({ error: 'XML içinde ürün bulunamadı.' }); return; }

    const xmlFields        = collectXmlFields(nodes);
    const sampleRows       = nodes.slice(0, 5).map(n => nodeToRow(n, xmlFields));
    const suggestedMapping = suggestMapping(xmlFields);
    const filename         = url.split('/').pop()?.split('?')[0] ?? 'url-import.xml';

    res.json({
      status: 'success',
      data: {
        totalRows:        nodes.length,
        xmlFields,
        sampleRows,
        suggestedMapping,
        targetFields:     TARGET_FIELDS,
        filename,
        fileSizeBytes:    buffer.length,
        sourceUrl:        url.trim(),
        xmlFormat,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'URL önizleme sırasında hata oluştu.' });
  }
};

// ─── Import from URL endpoint ─────────────────────────────────────────────────

export const importXmlFromUrl = async (req: AuthRequest, res: Response): Promise<void> => {
  const startedAt = new Date();
  const tenantId  = req.user!.tenantId!;
  const userId    = req.user!.userId ?? req.user!.id;

  try {
    const { url, mapping: rawMapping, duplicateMode: rawMode } = req.body as {
      url?: string;
      mapping?: Record<string, string>;
      duplicateMode?: string;
    };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url alanı zorunludur.' });
      return;
    }

    const mapping:       Record<string, string> = rawMapping ?? {};
    const duplicateMode: DuplicateMode          = (rawMode as DuplicateMode) ?? 'skip';

    // Validate required mapping
    const mappedTargets = Object.values(mapping).filter(v => v !== '__ignore__');
    if (!mappedTargets.includes('name'))  { res.status(422).json({ error: 'Ürün Adı alanı eşleştirilmesi zorunludur.' }); return; }
    if (!mappedTargets.includes('price')) { res.status(422).json({ error: 'Satış Fiyatı alanı eşleştirilmesi zorunludur.' }); return; }

    let buffer: Buffer;
    try { buffer = await fetchUrlAsBuffer(url.trim()); }
    catch (e: any) { res.status(400).json({ error: e.message }); return; }

    const { nodes, error } = parseXmlToNodes(buffer);
    if (error || nodes.length === 0) { res.status(400).json({ error: error ?? 'XML içinde ürün bulunamadı.' }); return; }

    // Reuse the same processing logic from file import
    const existingByBarcode = new Map<string, { id: string; name: string }>();
    const existingBySku     = new Map<string, { id: string; name: string }>();
    const existingProducts  = await prisma.product.findMany({
      where:  { tenantId, barcode: { not: null } },
      select: { id: true, name: true, barcode: true, sku: true },
    });
    for (const p of existingProducts) {
      if (p.barcode) existingByBarcode.set(p.barcode.trim().toLowerCase(), { id: p.id, name: p.name });
      if (p.sku)     existingBySku.set(p.sku.trim().toLowerCase(),         { id: p.id, name: p.name });
    }

    const results:    ImportRowResult[] = [];
    let importedCnt  = 0, updatedCnt = 0, skippedCnt = 0, failedCnt = 0;

    for (let i = 0; i < nodes.length; i++) {
      const row    = i + 1;
      const node   = nodes[i];
      const data   = applyMapping(node, mapping);
      const errors = validateRow(data, row);

      if (errors.length > 0) {
        results.push({ row, name: data.name ?? '—', barcode: data.barcode ?? '', status: 'error', errors: errors.map(e => `${e.field}: ${e.message}`) });
        failedCnt++; continue;
      }

      const barcodeKey = data.barcode ? data.barcode.trim().toLowerCase() : null;
      const skuKey     = data.sku     ? data.sku.trim().toLowerCase()     : null;
      const existing   = (barcodeKey && existingByBarcode.get(barcodeKey)) || (skuKey && existingBySku.get(skuKey)) || null;

      if (existing) {
        if (duplicateMode === 'error') {
          results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'error', errors: [`Mevcut ürün ile çakışma: "${existing.name}"`] });
          failedCnt++; continue;
        }
        if (duplicateMode === 'skip') {
          results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'skipped', errors: [`Atlandı: "${existing.name}" ile çakışma`] });
          skippedCnt++; continue;
        }
        // update
        try {
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              name: data.name!, price: data.price!,
              ...(data.barcode     ? { barcode: data.barcode }         : {}),
              ...(data.sku         ? { sku: data.sku }                 : {}),
              ...(data.description ? { description: data.description } : {}),
              ...(data.brand       ? { brand: data.brand }             : {}),
              ...(data.unit        ? { unit: data.unit }               : {}),
            },
          });
          await prisma.productPrice.upsert({
            where:  { productId: existing.id },
            create: { productId: existing.id, salePrice: data.price!, discountPrice: data.discountPrice ?? null, vatRate: 18, currency: 'TRY' },
            update: { salePrice: data.price!, ...(data.discountPrice != null ? { discountPrice: data.discountPrice } : {}) },
          });
          if (data.stock != null) {
            await prisma.stock.upsert({
              where:  { productId: existing.id },
              create: { productId: existing.id, tenantId, quantity: data.stock, unit: data.unit ?? 'adet' },
              update: { quantity: data.stock },
            });
          }
          if (data.imageUrl) {
            const existingImg = await prisma.productImage.findFirst({ where: { productId: existing.id, isMain: true } });
            if (existingImg) {
              await prisma.productImage.update({ where: { id: existingImg.id }, data: { url: data.imageUrl } });
            } else {
              await prisma.productImage.create({ data: { productId: existing.id, url: data.imageUrl, isMain: true, alt: data.name ?? '', order: 0 } });
            }
          }
          if (barcodeKey) existingByBarcode.set(barcodeKey, { id: existing.id, name: data.name! });
          results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'updated' });
          updatedCnt++;
        } catch (e: any) {
          results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'error', errors: [e.message] });
          failedCnt++;
        }
        continue;
      }

      // create
      try {
        const slug    = await generateUniqueProductSlug(data.name!, tenantId);
        const created = await prisma.product.create({
          data: {
            name: data.name!, slug, price: data.price!,
            barcode: data.barcode ?? null, sku: data.sku ?? null,
            description: data.description ?? null, brand: data.brand ?? null,
            unit: data.unit ?? 'adet', status: 'draft', isActive: false, hasVariants: false,
            tenant:  { connect: { id: tenantId } },
            pricing: { create: { salePrice: data.price!, discountPrice: data.discountPrice ?? null, vatRate: 18, currency: 'TRY' } },
          },
        });
        if (data.stock != null) {
          await prisma.stock.create({ data: { productId: created.id, tenantId, quantity: data.stock, unit: data.unit ?? 'adet' } });
        }
        if (data.imageUrl) {
          await prisma.productImage.create({
            data: { productId: created.id, url: data.imageUrl, isMain: true, alt: data.name ?? '', order: 0 },
          }).catch(() => {});
        }
        if (barcodeKey) existingByBarcode.set(barcodeKey, { id: created.id, name: created.name });
        if (skuKey)     existingBySku.set(skuKey,         { id: created.id, name: created.name });
        results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'imported' });
        importedCnt++;
      } catch (e: any) {
        results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'error', errors: [e.message] });
        failedCnt++;
      }
    }

    const summary = { total: nodes.length, imported: importedCnt, updated: updatedCnt, skipped: skippedCnt, failed: failedCnt };
    const filename = url.split('/').pop()?.split('?')[0] ?? 'url-import.xml';

    try {
      await prisma.importLog.create({
        data: {
          filename,
          type:        'XML',
          status:      failedCnt === nodes.length ? 'failed' : failedCnt > 0 ? 'partial' : 'success',
          totalRows:   nodes.length,
          successRows: importedCnt + updatedCnt,
          failedRows:  failedCnt,
          errors:      results.filter(r => r.status === 'error').slice(0, 200) as any,
          startedAt,
          completedAt: new Date(),
          createdBy:   userId,
          tenant:      { connect: { id: tenantId } },
        },
      });
    } catch { /* non-blocking */ }

    res.json({ status: 'success', summary, results });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'URL import sırasında hata oluştu.' });
  }
};

// ─── Shared streaming import processor ───────────────────────────────────────
//
// Processes nodes one-by-one and writes NDJSON progress events to the response.
// Each line is: { type: 'progress', current, total, name, status }
// Final line:   { type: 'done', summary, results }

async function streamImportNodes(params: {
  res:            Response;
  nodes:          Record<string, string>[];
  mapping:        Record<string, string>;
  duplicateMode:  DuplicateMode;
  skipZeroStock:  boolean;
  tenantId:       string;
  userId:         string;
  filename:       string;
  startedAt:      Date;
}): Promise<void> {
  const { res, nodes, mapping, duplicateMode, skipZeroStock, tenantId, userId, filename, startedAt } = params;

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx response buffering
  res.flushHeaders();

  const send = (data: object) => {
    if (!res.writableEnded) res.write(JSON.stringify(data) + '\n');
  };

  // Pre-load existing products for duplicate detection
  const existingByBarcode = new Map<string, { id: string; name: string }>();
  const existingBySku     = new Map<string, { id: string; name: string }>();
  // In-memory category cache: normalised name → category id (avoids N DB hits per row)
  const categoryCache     = new Map<string, string>();

  try {
    const existingProducts = await prisma.product.findMany({
      where:  { tenantId, barcode: { not: null } },
      select: { id: true, name: true, barcode: true, sku: true },
    });
    for (const p of existingProducts) {
      if (p.barcode) existingByBarcode.set(p.barcode.trim().toLowerCase(), { id: p.id, name: p.name });
      if (p.sku)     existingBySku.set(p.sku.trim().toLowerCase(),         { id: p.id, name: p.name });
    }
    // Pre-load existing categories
    const existingCats = await prisma.category.findMany({
      where:  { tenantId },
      select: { id: true, name: true },
    });
    for (const c of existingCats) {
      categoryCache.set(c.name.trim().toLowerCase(), c.id);
    }
  } catch (err: any) {
    send({ type: 'error', message: err.message ?? 'Veritabanı bağlantı hatası.' });
    res.end();
    return;
  }

  // Helper: find or create a category by name, returns its id
  const findOrCreateCategory = async (rawName: string): Promise<string | null> => {
    const trimmed = rawName.trim();
    if (!trimmed) return null;
    const key = trimmed.toLowerCase();
    if (categoryCache.has(key)) return categoryCache.get(key)!;

    // Support "Parent > Child" hierarchy (common in WooCommerce exports)
    const parts = trimmed.split('>').map(p => p.trim()).filter(Boolean);
    let parentId: string | null = null;
    let finalId: string | null  = null;

    for (let depth = 0; depth < parts.length; depth++) {
      const partName = parts[depth];
      const partKey  = partName.toLowerCase();
      const cacheKey = depth === 0 ? partKey : parts.slice(0, depth + 1).join(' > ').toLowerCase();

      if (categoryCache.has(cacheKey)) {
        parentId = categoryCache.get(cacheKey)!;
        finalId  = parentId;
        continue;
      }

      // Look for existing category with this name + parent
      const existing = await prisma.category.findFirst({
        where: { tenantId, name: { equals: partName, mode: 'insensitive' }, parentId: parentId ?? undefined },
        select: { id: true },
      });

      if (existing) {
        categoryCache.set(cacheKey, existing.id);
        parentId = existing.id;
        finalId  = existing.id;
      } else {
        // Create new category
        const slug = generateSEOSlug(partName) || `kategori-${Date.now()}`;
        const created = await prisma.category.create({
          data: {
            name:     partName,
            slug:     `${slug}-${Date.now()}`,
            level:    depth,
            parentId: parentId,
            tenantId,
          },
        });
        categoryCache.set(cacheKey, created.id);
        parentId = created.id;
        finalId  = created.id;
      }
    }
    return finalId;
  };

  const results: ImportRowResult[] = [];
  let importedCnt = 0, updatedCnt = 0, skippedCnt = 0, failedCnt = 0;

  for (let i = 0; i < nodes.length; i++) {
    if (res.writableEnded) break;

    const row    = i + 1;
    const node   = nodes[i];
    const data   = applyMapping(node, mapping);
    const errors = validateRow(data, row);
    let   rowStatus: ImportRowResult['status'] = 'error';

    if (errors.length > 0) {
      results.push({ row, name: data.name ?? '—', barcode: data.barcode ?? '', status: 'error', errors: errors.map(e => `${e.field}: ${e.message}`) });
      failedCnt++;
    } else if (skipZeroStock && data.stock != null && data.stock === 0) {
      results.push({ row, name: data.name ?? '—', barcode: data.barcode ?? '', status: 'skipped', errors: ['Stok miktarı 0 olduğu için atlandı'] });
      skippedCnt++; rowStatus = 'skipped';
    } else {
      const barcodeKey = data.barcode ? data.barcode.trim().toLowerCase() : null;
      const skuKey     = data.sku     ? data.sku.trim().toLowerCase()     : null;
      const existing   = (barcodeKey && existingByBarcode.get(barcodeKey)) || (skuKey && existingBySku.get(skuKey)) || null;

      if (existing) {
        if (duplicateMode === 'error') {
          results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'error', errors: [`Mevcut ürün ile çakışma: "${existing.name}"`] });
          failedCnt++; rowStatus = 'error';
        } else if (duplicateMode === 'skip') {
          results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'skipped', errors: [`Atlandı: "${existing.name}" ile çakışma`] });
          skippedCnt++; rowStatus = 'skipped';
        } else {
          // update
          try {
            const categoryId = data.category ? await findOrCreateCategory(data.category) : undefined;
            await prisma.product.update({
              where: { id: existing.id },
              data:  {
                name: data.name!, price: data.price!,
                ...(data.barcode     ? { barcode: data.barcode }         : {}),
                ...(data.sku         ? { sku: data.sku }                 : {}),
                ...(data.description ? { description: data.description } : {}),
                ...(data.brand       ? { brand: data.brand }             : {}),
                ...(data.unit        ? { unit: data.unit }               : {}),
                ...(categoryId       ? { category: { connect: { id: categoryId } } } : {}),
              },
            });
            await prisma.productPrice.upsert({
              where:  { productId: existing.id },
              create: { productId: existing.id, salePrice: data.price!, discountPrice: data.discountPrice ?? null, vatRate: 18, currency: 'TRY' },
              update: { salePrice: data.price!, ...(data.discountPrice != null ? { discountPrice: data.discountPrice } : {}) },
            });
            if (data.stock != null) {
              await prisma.stock.upsert({
                where:  { productId: existing.id },
                create: { productId: existing.id, tenantId, quantity: data.stock, unit: data.unit ?? 'adet' },
                update: { quantity: data.stock },
              });
            }
            if (data.imageUrl) {
              const existingImg = await prisma.productImage.findFirst({ where: { productId: existing.id, isMain: true } });
              if (existingImg) {
                await prisma.productImage.update({ where: { id: existingImg.id }, data: { url: data.imageUrl } });
              } else {
                await prisma.productImage.create({ data: { productId: existing.id, url: data.imageUrl, isMain: true, alt: data.name ?? '', order: 0 } });
              }
            }
            if (barcodeKey) existingByBarcode.set(barcodeKey, { id: existing.id, name: data.name! });
            results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'updated' });
            updatedCnt++; rowStatus = 'updated';
          } catch (e: any) {
            results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'error', errors: [e.message] });
            failedCnt++; rowStatus = 'error';
          }
        }
      } else {
        // create
        try {
          const categoryId = data.category ? await findOrCreateCategory(data.category) : null;
          const slug       = await generateUniqueProductSlug(data.name!, tenantId);
          const created    = await prisma.product.create({
            data: {
              name: data.name!, slug, price: data.price!,
              barcode: data.barcode ?? null, sku: data.sku ?? null,
              description: data.description ?? null, brand: data.brand ?? null,
              unit: data.unit ?? 'adet', status: 'draft', isActive: false, hasVariants: false,
              tenant:   { connect: { id: tenantId } },
              ...(categoryId ? { category: { connect: { id: categoryId } } } : {}),
              pricing: { create: { salePrice: data.price!, discountPrice: data.discountPrice ?? null, vatRate: 18, currency: 'TRY' } },
            },
          });
          if (data.stock != null) {
            await prisma.stock.create({ data: { productId: created.id, tenantId, quantity: data.stock, unit: data.unit ?? 'adet' } });
          }
          if (data.imageUrl) {
            await prisma.productImage.create({
              data: { productId: created.id, url: data.imageUrl, isMain: true, alt: data.name ?? '', order: 0 },
            }).catch(() => {});
          }
          prisma.product.findUnique({
            where: { id: created.id },
            include: { pricing: true, images: true, category: true, variants: true },
          }).then(p => { if (p) searchService.upsertProduct(toProductDocument(p as any)); }).catch(() => {});
          if (barcodeKey) existingByBarcode.set(barcodeKey, { id: created.id, name: created.name });
          if (skuKey)     existingBySku.set(skuKey,         { id: created.id, name: created.name });
          results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'imported' });
          importedCnt++; rowStatus = 'imported';
        } catch (e: any) {
          results.push({ row, name: data.name!, barcode: data.barcode ?? '', status: 'error', errors: [e.message] });
          failedCnt++; rowStatus = 'error';
        }
      }
    }

    send({ type: 'progress', current: row, total: nodes.length, name: data.name ?? `Satır ${row}`, status: rowStatus });
  }

  const summary = { total: nodes.length, imported: importedCnt, updated: updatedCnt, skipped: skippedCnt, failed: failedCnt };

  try {
    await prisma.importLog.create({
      data: {
        filename,
        type:        'XML',
        status:      failedCnt === nodes.length ? 'failed' : failedCnt > 0 ? 'partial' : 'success',
        totalRows:   nodes.length,
        successRows: importedCnt + updatedCnt,
        failedRows:  failedCnt,
        errors:      results.filter(r => r.status === 'error').slice(0, 200) as any,
        startedAt,
        completedAt: new Date(),
        createdBy:   userId,
        tenant:      { connect: { id: tenantId } },
      },
    });
  } catch { /* non-blocking */ }

  send({ type: 'done', summary, results });
  res.end();
}

// ─── Streaming import from file ───────────────────────────────────────────────

export const importXmlStream = async (req: AuthRequest, res: Response): Promise<void> => {
  const startedAt = new Date();
  const tenantId  = req.user!.tenantId!;
  const userId    = req.user!.userId ?? req.user!.id;

  try {
    if (!req.file) { res.status(400).json({ error: 'XML dosyası yüklenmedi.' }); return; }

    let mapping: Record<string, string> = {};
    let duplicateMode: DuplicateMode = 'skip';
    let skipZeroStock = false;
    try {
      if (req.body.mapping)       mapping       = JSON.parse(req.body.mapping);
      if (req.body.duplicateMode) duplicateMode = req.body.duplicateMode as DuplicateMode;
      if (req.body.skipZeroStock) skipZeroStock = req.body.skipZeroStock === 'true' || req.body.skipZeroStock === true;
    } catch {
      res.status(400).json({ error: 'Geçersiz mapping JSON formatı.' }); return;
    }

    const mappedTargets = Object.values(mapping).filter(v => v !== '__ignore__');
    if (!mappedTargets.includes('name'))  { res.status(422).json({ error: 'Ürün Adı alanı eşleştirilmesi zorunludur.' }); return; }
    if (!mappedTargets.includes('price')) { res.status(422).json({ error: 'Satış Fiyatı alanı eşleştirilmesi zorunludur.' }); return; }

    const { nodes, error } = parseXmlToNodes(req.file.buffer);
    if (error || nodes.length === 0) { res.status(400).json({ error: error ?? 'XML içinde ürün bulunamadı.' }); return; }

    await streamImportNodes({ res, nodes, mapping, duplicateMode, skipZeroStock, tenantId, userId, filename: req.file.originalname, startedAt });
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message ?? 'XML stream hatası.' });
    } else {
      try { res.write(JSON.stringify({ type: 'error', message: err?.message ?? 'XML stream hatası.' }) + '\n'); res.end(); } catch { /* ignore */ }
    }
  }
};

// ─── Streaming import from URL ────────────────────────────────────────────────

export const importXmlFromUrlStream = async (req: AuthRequest, res: Response): Promise<void> => {
  const startedAt = new Date();
  const tenantId  = req.user!.tenantId!;
  const userId    = req.user!.userId ?? req.user!.id;

  try {
    const { url, mapping: rawMapping, duplicateMode: rawMode, skipZeroStock: rawSkipZero } = req.body as {
      url?: string;
      mapping?: Record<string, string>;
      duplicateMode?: string;
      skipZeroStock?: boolean;
    };

    if (!url || typeof url !== 'string' || !url.trim()) { res.status(400).json({ error: 'url alanı zorunludur.' }); return; }

    const mapping:       Record<string, string> = rawMapping ?? {};
    const duplicateMode: DuplicateMode          = (rawMode as DuplicateMode) ?? 'skip';
    const skipZeroStock: boolean                = rawSkipZero === true;

    const mappedTargets = Object.values(mapping).filter(v => v !== '__ignore__');
    if (!mappedTargets.includes('name'))  { res.status(422).json({ error: 'Ürün Adı alanı eşleştirilmesi zorunludur.' }); return; }
    if (!mappedTargets.includes('price')) { res.status(422).json({ error: 'Satış Fiyatı alanı eşleştirilmesi zorunludur.' }); return; }

    let buffer: Buffer;
    try { buffer = await fetchUrlAsBuffer(url.trim()); }
    catch (e: any) { res.status(400).json({ error: e.message }); return; }

    const { nodes, error } = parseXmlToNodes(buffer);
    if (error || nodes.length === 0) { res.status(400).json({ error: error ?? 'XML içinde ürün bulunamadı.' }); return; }

    const filename = url.split('/').pop()?.split('?')[0] ?? 'url-import.xml';
    await streamImportNodes({ res, nodes, mapping, duplicateMode, skipZeroStock, tenantId, userId, filename, startedAt });
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message ?? 'URL stream hatası.' });
    } else {
      try { res.write(JSON.stringify({ type: 'error', message: err?.message ?? 'URL stream hatası.' }) + '\n'); res.end(); } catch { /* ignore */ }
    }
  }
};

// ─── Import history endpoint ──────────────────────────────────────────────────

export const importHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId!;
    const logs = await prisma.importLog.findMany({
      where:   { tenantId, type: 'XML' },
      orderBy: { startedAt: 'desc' },
      take:    20,
      select: {
        id: true, filename: true, status: true,
        totalRows: true, successRows: true, failedRows: true,
        startedAt: true, completedAt: true,
      },
    });
    res.json({ status: 'success', data: logs });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Geçmiş alınamadı.' });
  }
};
