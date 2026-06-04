import { Request, Response } from 'express';
import type { StoreCustomerAuthRequest } from './store-customer-auth.middleware';
import { ProductService } from '../products/product.service';
import { StockError } from '../orders/order.service';
import { resolveStoreTenant, tenantJson } from './store-tenant.util';
import {
  categoryMetaDescription,
  productMetaDescription,
  readCustomField,
  storefrontCategoryPath,
  storefrontProductPath,
  storefrontUsesCustomDomain,
} from './store-public-seo.util';
import { createStoreOrderSchema } from './store-order.dto';
import { storeOrderService } from './store-order.service';
import { storeOrderStatusService } from './store-order-status.service';
import { storeOrderPaymentPendingService } from './store-order-payment-pending.service';
import { storePaymentProviderService } from '../payments/store-payment-provider.service';
import prisma from '../../config/database';

const productService = new ProductService();

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v && typeof (v as any).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function collectImageUrls(product: {
  productImages?: Array<{ url: string; order: number }>;
  images?: string[];
}): string[] {
  const fromRel = (product.productImages ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(i => i.url)
    .filter(Boolean);
  const legacy = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of [...fromRel, ...legacy]) {
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

export async function listProducts(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ status: 'error', error: 'Mağaza bulunamadı. tenant parametresi veya alan adı gerekli.' });
      return;
    }

    const page  = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 24));
    const categoryId = typeof req.query.category === 'string' && req.query.category ? req.query.category : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const result = await productService.getAll(tenant.id, {
      page,
      limit,
      categoryId,
      search,
      status:   'active',
      isActive: true,
      sortBy:   'createdAt',
      sortDir:  'desc',
    });

    res.json({
      status: 'success',
      tenant: tenantJson(tenant),
      data:   {
        items: result.items.map(p => ({
          id:            p.id,
          name:          p.name,
          slug:          p.slug,
          price:         num(p.price),
          discountPrice: p.discountPrice != null ? num(p.discountPrice) : null,
          image:         p.mainImage,
          stock:         p.stock,
          category:      p.category,
        })),
        page:       result.page,
        limit:      result.limit,
        total:      result.total,
        totalPages: result.totalPages,
      },
    });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e?.message ?? 'Ürünler alınamadı.' });
  }
}

export async function getProductBySlug(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ status: 'error', error: 'Mağaza bulunamadı.' });
      return;
    }

    const raw  = req.params.slug;
    const slug = typeof raw === 'string' ? raw.trim() : Array.isArray(raw) ? String(raw[0] ?? '').trim() : '';
    if (!slug) {
      res.status(400).json({ status: 'error', error: 'Geçersiz ürün adresi.' });
      return;
    }

    const p = await productService.getBySlug(slug, tenant.id);
    if (!p || !p.isActive || p.status !== 'active') {
      res.status(404).json({ status: 'error', error: 'Ürün bulunamadı.' });
      return;
    }

    const price         = num(p.pricing?.salePrice ?? p.price);
    const discountPrice = p.pricing?.discountPrice != null ? num(p.pricing.discountPrice) : null;
    const images        = collectImageUrls(p);
    const useCustom     = storefrontUsesCustomDomain(tenant.customDomain, tenant.domainVerified);
    const metaTitle     = readCustomField(p.customFields, 'metaTitle') ?? p.name;
    const metaDescription = productMetaDescription(
      p.name,
      p.description,
      readCustomField(p.customFields, 'metaDescription'),
    );

    res.json({
      status: 'success',
      tenant: tenantJson(tenant),
      data:   {
        id:          p.id,
        name:        p.name,
        slug:        p.slug,
        description: p.description ?? '',
        price,
        discountPrice,
        stock:       Number((p as { stock?: { quantity?: unknown } }).stock?.quantity ?? 0),
        images,
        category:    p.category
          ? { id: p.category.id, name: p.category.name, slug: p.category.slug }
          : null,
        metaTitle,
        metaDescription,
        canonicalPath: storefrontProductPath(slug, tenant.slug, useCustom),
        ogImage:       images[0] ?? null,
      },
    });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e?.message ?? 'Ürün alınamadı.' });
  }
}

export async function listCategories(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ status: 'error', error: 'Mağaza bulunamadı.' });
      return;
    }

    const rows = await prisma.category.findMany({
      where: {
        tenantId: tenant.id,
        isActive: true,
      },
      select: {
        id:              true,
        name:            true,
        slug:            true,
        description:     true,
        imageUrl:        true,
        parentId:        true,
        order:           true,
        level:           true,
        metaTitle:       true,
        metaDescription: true,
      },
      orderBy: [{ level: 'asc' }, { order: 'asc' }, { name: 'asc' }],
    });

    const useCustom = storefrontUsesCustomDomain(tenant.customDomain, tenant.domainVerified);

    res.json({
      status: 'success',
      tenant: tenantJson(tenant),
      data:   rows.map(row => ({
        id:          row.id,
        name:        row.name,
        slug:        row.slug,
        description: row.description,
        imageUrl:    row.imageUrl,
        parentId:    row.parentId,
        order:       row.order,
        level:       row.level,
        metaTitle:       row.metaTitle?.trim() || row.name,
        metaDescription: categoryMetaDescription(
          row.name,
          row.description,
          row.metaDescription?.trim() || null,
        ),
        canonicalPath: storefrontCategoryPath(row.slug, tenant.slug, useCustom),
      })),
    });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e?.message ?? 'Kategoriler alınamadı.' });
  }
}

export async function listStorePaymentMethods(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
      return;
    }
    const methods = await storePaymentProviderService.listActiveMethodsForStorefront(tenant.id);
    res.json({ success: true, methods });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Ödeme yöntemleri alınamadı.';
    res.status(500).json({ success: false, error: msg });
  }
}

export async function resendStoreOrderPaymentPendingEmail(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ success: false, message: 'Mağaza bulunamadı.' });
      return;
    }

    const orderNumber = typeof req.params.orderNumber === 'string' ? req.params.orderNumber : '';
    if (!orderNumber.trim()) {
      res.status(400).json({ success: false, message: 'Sipariş numarası gerekli.' });
      return;
    }

    const result = await storeOrderPaymentPendingService.resendPaymentPendingEmail(
      tenant.id,
      orderNumber,
    );
    res.status(result.statusCode).json({
      success: result.success,
      message: result.message,
    });
  } catch (e: unknown) {
    res.status(500).json({
      success: false,
      message: 'Ödeme bilgileri şu anda gönderilemedi. Lütfen daha sonra tekrar deneyin.',
    });
  }
}

export async function getStoreOrderPaymentPending(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
      return;
    }

    const orderNumber = typeof req.params.orderNumber === 'string' ? req.params.orderNumber : '';
    if (!orderNumber.trim()) {
      res.status(400).json({ success: false, error: 'Sipariş numarası gerekli.' });
      return;
    }

    const result = await storeOrderPaymentPendingService.getByOrderNumber(tenant.id, orderNumber);
    if (!result) {
      res.status(404).json({ success: false, error: 'Sipariş bulunamadı.' });
      return;
    }

    res.json({ success: true, order: result.order, bankTransferPayment: result.bankTransferPayment });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Ödeme bilgileri alınamadı.';
    res.status(500).json({ success: false, error: msg });
  }
}

export async function getStoreOrderStatus(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
      return;
    }

    const orderNumber = typeof req.params.orderNumber === 'string' ? req.params.orderNumber : '';
    if (!orderNumber.trim()) {
      res.status(400).json({ success: false, error: 'Sipariş numarası gerekli.' });
      return;
    }

    const result = await storeOrderStatusService.getByOrderNumber(tenant.id, orderNumber);
    if (!result) {
      res.status(404).json({ success: false, error: 'Sipariş bulunamadı.' });
      return;
    }

    res.json({ success: true, order: result.order, payment: result.payment });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Sipariş durumu alınamadı.';
    res.status(500).json({ success: false, error: msg });
  }
}

export async function validateStoreCoupon(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
      return;
    }

    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!code) {
      res.status(400).json({ success: false, error: 'Kupon kodu zorunludur.' });
      return;
    }
    if (!items?.length) {
      res.status(400).json({ success: false, error: 'Sepet ürünleri gerekli.' });
      return;
    }

    const parsedItems = items.map((line: { productId?: string; variantId?: string | null; quantity?: number }) => ({
      productId:  String(line.productId ?? ''),
      variantId:  line.variantId ?? null,
      quantity:   Number(line.quantity) || 0,
    }));

    const result = await storeOrderService.validateCoupon(
      tenant.id,
      code,
      parsedItems.filter(i => i.productId && i.quantity > 0),
      req.storeCustomer?.customerId,
    );

    res.json({ success: true, data: result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Kupon doğrulanamadı.';
    res.status(400).json({ success: false, error: msg });
  }
}

export async function createStoreOrder(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    const tenant = await resolveStoreTenant(req);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Mağaza bulunamadı. tenant parametresi veya alan adı gerekli.' });
      return;
    }

    const parsed = createStoreOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map(i => i.message).join('; ') || 'Geçersiz istek gövdesi.';
      res.status(400).json({ success: false, error: msg });
      return;
    }

    const result = await storeOrderService.create(tenant.id, parsed.data, {
      authenticatedCustomerId: req.storeCustomer?.customerId,
    });

    res.status(201).json({
      success: true,
      order: {
        id:          result.order.id,
        orderNumber: result.order.orderNumber,
        status:      result.order.status,
        total:       Number(result.order.totalAmount),
        currency:    result.order.currency,
      },
      summary: result.summary,
    });
  } catch (e: unknown) {
    if (e instanceof StockError) {
      res.status(400).json({ success: false, error: e.message });
      return;
    }
    const msg = e instanceof Error ? e.message : 'Sipariş oluşturulamadı.';
    const isClient = /bulunamadı|yetersiz|geçersiz|en az|satışa kapalı|kabul|kısıtlan|kupon/i.test(msg);
    res.status(isClient ? 400 : 500).json({ success: false, error: msg });
  }
}
