import { Prisma, PrismaClient, TenantUsageAction } from '@prisma/client';
import prisma from '../../config/database';
import { logger } from '../../config/logger';
import { logTenantUsage } from '../../services/tenantUsageLog.service';
import { CouponService, calcDiscount } from '../coupons/coupon.service';
import { CampaignService, CartItem as CampaignCartItem } from '../campaigns/campaign.service';
import {
  shouldSendBankTransferPaymentApproved,
  shouldSendCustomerStatusEmail,
} from '../email/templates/store-email.util';
import {
  initialOrderPaymentStatus,
  isBankTransferPaymentAwaitingConfirm,
  isBankTransferProvider,
  resolveOrderPaymentProvider,
} from './order-payment.util';
import { normalizeShippingInput, type OrderShippingInput } from './order-shipping.util';
import {
  normalizeInvoiceNumber,
  normalizeInvoiceUrl,
  type OrderInvoiceInput,
} from './order-invoice.util';
import type { OrderPaymentStatus, PaymentProviderType } from '@prisma/client';
import { storeEmailService } from '../store-public/store-email.service';
import type { OrderListQuery } from './order-list.query';
import { buildOrderListWhere } from './order-list.util';
import { buildTrendyolOrderListWhere } from './order-list-trendyol.util';
import { toAdminOrderListJson } from './order-admin.presenter';
import {
  mapStorefrontListItemToUnified,
  mapTrendyolOrderToUnified,
  unifiedSortKey,
} from './order-unified.presenter';
import type { OrderStatus } from '@prisma/client';
import { auditService } from '../audit/audit.service';
import { mapAuditLogsToOrderHistory } from './order-history.mapper';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CreateOrderItemDto {
  productId:  string;
  variantId?: string;
  quantity:   number;
  price:      number;
}

export interface CreateOrderDto {
  customerId:  string;
  items:       CreateOrderItemDto[];
  notes?:      string;
  currency?:   string;
  couponCode?: string;   // optional — applied during order creation
  /** Kargo ücreti — sunucuda hesaplanır, vitrin siparişlerinde zorunlu doğrulama */
  shippingPrice?: number;
  /** Kapıda ödeme vb. ek ücretler */
  extraFees?: number;
  paymentProvider?: PaymentProviderType;
  paymentStatus?: OrderPaymentStatus;
}

export interface GetAllOrdersQuery {
  page?:             number;
  limit?:            number;
  status?:           string;
  search?:           string;
  paymentProvider?:  PaymentProviderType;
  paymentStatus?:    OrderPaymentStatus;
  source?:           'all' | 'storefront' | 'trendyol';
  operationFilter?:  OrderListQuery['operationFilter'];
}

/** Sipariş durumu güncellemesi — müşteri e-postası isteğe bağlı (admin vs ödeme callback). */
export type OrderStatusUpdateOptions = {
  /** true: admin vb. kaynaklı geçişlerde STORE_ORDER_STATUS_UPDATED; false: PayTR callback vb. */
  notifyCustomer?: boolean;
};

// ── Prisma includes ────────────────────────────────────────────────────────

const ORDER_INCLUDE = {
  customer: {
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  },
  items: {
    include: {
      product: { select: { id: true, name: true, slug: true } },
      variant: { select: { id: true, name: true, sku: true, stockQuantity: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  coupon: {
    select: { id: true, code: true, discountType: true, value: true },
  },
  paymentSessions: {
    select: { id: true, provider: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' as const },
    take:    1,
  },
} satisfies Prisma.OrderInclude;

// ── Stock helpers (always called inside a transaction) ─────────────────────

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Decrement stock for every order item.
 * Variant items → ProductVariant.stockQuantity
 * Plain items   → Stock.quantity (product-level stock table)
 * Throws a descriptive error if stock would go negative.
 */
async function deductStock(
  tx:       Tx,
  items:    CreateOrderItemDto[],
  tenantId: string,
): Promise<void> {
  for (const item of items) {
    if (item.variantId) {
      // ── Variant-level stock ──────────────────────────────────────
      const variant = await tx.productVariant.findFirst({
        where:  { id: item.variantId, product: { tenantId } },
        select: { id: true, name: true, stockQuantity: true },
      });

      if (!variant) {
        throw new Error(`Varyant bulunamadı: ${item.variantId}`);
      }

      const available = Number(variant.stockQuantity);
      if (available < item.quantity) {
        throw new StockError(
          `Yetersiz stok: varyant "${variant.name}" ` +
          `(mevcut: ${available}, istenen: ${item.quantity})`,
          { variantId: item.variantId, available, requested: item.quantity },
        );
      }

      await tx.productVariant.update({
        where: { id: item.variantId },
        data:  {
          stockQuantity: {
            decrement: item.quantity,
          },
        },
      });
    } else {
      // ── Product-level stock ──────────────────────────────────────
      const stock = await tx.stock.findFirst({
        where:  { productId: item.productId, tenantId },
        select: { id: true, quantity: true },
      });

      if (!stock) {
        // No Stock record → tracking not configured, skip silently
        continue;
      }

      const available = Number(stock.quantity);
      if (available < item.quantity) {
        const product = await tx.product.findUnique({
          where:  { id: item.productId },
          select: { name: true },
        });
        throw new StockError(
          `Yetersiz stok: "${product?.name ?? item.productId}" ` +
          `(mevcut: ${available}, istenen: ${item.quantity})`,
          { productId: item.productId, available, requested: item.quantity },
        );
      }

      await tx.stock.update({
        where: { id: stock.id },
        data:  {
          quantity: {
            decrement: item.quantity,
          },
        },
      });
    }
  }
}

/**
 * Restore stock for every item of a given order (undo deductStock).
 * Used when an order is cancelled.
 * Silently skips if the stock record no longer exists.
 */
async function restoreStock(tx: Tx, orderId: string): Promise<void> {
  const items = await tx.orderItem.findMany({
    where:  { orderId },
    select: { variantId: true, productId: true, quantity: true },
  });

  for (const item of items) {
    if (item.variantId) {
      // ── Restore variant stock ────────────────────────────────────
      await tx.productVariant.updateMany({
        where: { id: item.variantId },
        data:  { stockQuantity: { increment: item.quantity } },
      });
    } else {
      // ── Restore product-level stock ──────────────────────────────
      await tx.stock.updateMany({
        where: { productId: item.productId },
        data:  { quantity: { increment: item.quantity } },
      });
    }
  }
}

// ── Custom error class ─────────────────────────────────────────────────────

export class StockError extends Error {
  readonly meta: Record<string, unknown>;

  constructor(message: string, meta: Record<string, unknown> = {}) {
    super(message);
    this.name = 'StockError';
    this.meta = meta;
  }
}

// ── Cancelled statuses that should NOT touch stock again ──────────────────

const CANCELLED_STATUS = 'CANCELLED';

export const PANEL_MANUAL_ORDER_BLOCKED_CUSTOMER_MESSAGE =
  'Bu müşteri engelli olduğu için manuel sipariş oluşturulamaz.';

// ── Service ────────────────────────────────────────────────────────────────

export class OrderService {
  // ── List ────────────────────────────────────────────────────────────────

  async getAll(tenantId: string, query: GetAllOrdersQuery = {}) {
    const { page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const listQuery: OrderListQuery = {
      page:   Number(page),
      limit:  Number(limit),
      ...(query.status ? { status: query.status.toUpperCase() as OrderListQuery['status'] } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.paymentProvider ? { paymentProvider: query.paymentProvider } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.operationFilter ? { operationFilter: query.operationFilter } : {}),
    };

    const where = buildOrderListWhere(tenantId, listQuery);

    const [total, orders] = await prisma.$transaction([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include:  ORDER_INCLUDE,
        orderBy:  { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
    ]);

    return {
      orders,
      total,
      page:       Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    };
  }

  /** Storefront + Trendyol read-time merge (migration yok). */
  async getAllUnified(tenantId: string, query: GetAllOrdersQuery = {}) {
    const source = query.source ?? 'all';
    const page   = Number(query.page ?? 1);
    const limit  = Number(query.limit ?? 20);

    if (query.operationFilter) {
      if (source === 'trendyol') {
        return { orders: [], total: 0, page, totalPages: 1 };
      }
      const result   = await this.getAll(tenantId, query);
      const listJson = toAdminOrderListJson(result.orders as never);
      return {
        orders:     listJson.map(mapStorefrontListItemToUnified),
        total:      result.total,
        page:       result.page,
        totalPages: result.totalPages,
      };
    }

    if (source === 'storefront') {
      const result   = await this.getAll(tenantId, query);
      const listJson = toAdminOrderListJson(result.orders as never);
      return {
        orders:     listJson.map(mapStorefrontListItemToUnified),
        total:      result.total,
        page:       result.page,
        totalPages: result.totalPages,
      };
    }

    if (source === 'trendyol') {
      return this.getTrendyolOrdersUnified(tenantId, query, page, limit);
    }

    return this.getMergedOrdersUnified(tenantId, query, page, limit);
  }

  private buildListQuery(query: GetAllOrdersQuery): OrderListQuery {
    return {
      page:   Number(query.page ?? 1),
      limit:  Number(query.limit ?? 20),
      ...(query.status ? { status: query.status.toUpperCase() as OrderListQuery['status'] } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.paymentProvider ? { paymentProvider: query.paymentProvider } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.operationFilter ? { operationFilter: query.operationFilter } : {}),
    };
  }

  private async getTrendyolOrdersUnified(
    tenantId: string,
    query: GetAllOrdersQuery,
    page: number,
    limit: number,
  ) {
    const listQuery = this.buildListQuery(query);
    const where = buildTrendyolOrderListWhere(tenantId, {
      status: listQuery.status as OrderStatus | undefined,
      search: listQuery.search,
    });
    const skip = (page - 1) * limit;

    const [total, rows] = await prisma.$transaction([
      prisma.trendyolOrder.count({ where }),
      prisma.trendyolOrder.findMany({
        where,
        orderBy: { orderDate: 'desc' },
        skip,
        take:    limit,
      }),
    ]);

    return {
      orders:     rows.map(mapTrendyolOrderToUnified),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private async getMergedOrdersUnified(
    tenantId: string,
    query: GetAllOrdersQuery,
    page: number,
    limit: number,
  ) {
    const listQuery = this.buildListQuery(query);
    const paymentFiltersActive = !!(listQuery.paymentProvider || listQuery.paymentStatus);
    const storefrontWhere = buildOrderListWhere(tenantId, listQuery);

    const trendyolWhere = paymentFiltersActive
      ? ({ tenantId, id: { in: [] as string[] } } satisfies Prisma.TrendyolOrderWhereInput)
      : buildTrendyolOrderListWhere(tenantId, {
          status: listQuery.status as OrderStatus | undefined,
          search: listQuery.search,
        });

    const fetchCap = page * limit;

    const [storefrontTotal, trendyolTotal, storefrontRows, trendyolRows] = await Promise.all([
      prisma.order.count({ where: storefrontWhere }),
      prisma.trendyolOrder.count({ where: trendyolWhere }),
      prisma.order.findMany({
        where:   storefrontWhere,
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take:    fetchCap,
      }),
      prisma.trendyolOrder.findMany({
        where:   trendyolWhere,
        orderBy: { orderDate: 'desc' },
        take:    fetchCap,
      }),
    ]);

    const merged = [
      ...toAdminOrderListJson(storefrontRows as never).map(mapStorefrontListItemToUnified),
      ...trendyolRows.map(mapTrendyolOrderToUnified),
    ].sort((a, b) => unifiedSortKey(b.orderDate) - unifiedSortKey(a.orderDate));

    const total      = storefrontTotal + trendyolTotal;
    const paginated  = merged.slice((page - 1) * limit, page * limit);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      orders: paginated,
      total,
      page,
      totalPages,
    };
  }

  // ── Single ───────────────────────────────────────────────────────────────

  async getById(id: string, tenantId: string) {
    return prisma.order.findFirst({
      where:   { id, tenantId },
      include: ORDER_INCLUDE,
    });
  }

  // ── Create ───────────────────────────────────────────────────────────────

  async create(data: CreateOrderDto, tenantId: string) {
    const {
      customerId,
      items,
      notes,
      currency = 'TRY',
      couponCode,
      shippingPrice = 0,
      extraFees = 0,
      paymentProvider,
      paymentStatus,
    } = data;

    if (!items?.length) {
      throw new Error('En az bir ürün eklenmelidir.');
    }

    // ── Customer tenant isolation + panel manual order block ───────────────
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true, email: true, isBlocked: true, blockedReason: true },
    });
    if (!customer) {
      throw new Error('Müşteri bulunamadı veya bu hesaba ait değil.');
    }
    if (customer.isBlocked) {
      logger.warn({
        message:    'Blocked customer manual panel order rejected',
        tenantId,
        customerId: customer.id,
        email:      customer.email,
        ...(customer.blockedReason?.trim()
          ? { blockedReason: customer.blockedReason.trim() }
          : {}),
      });
      throw Object.assign(
        new Error(PANEL_MANUAL_ORDER_BLOCKED_CUSTOMER_MESSAGE),
        { statusCode: 422 },
      );
    }

    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    // ── Campaign engine ────────────────────────────────────────────────────
    // Fetch categoryId for each product so the engine can match scope=CATEGORY rules
    const productCategoryMap = new Map<string, string | null>();
    {
      const uniqueProductIds = [...new Set(items.map((i) => i.productId))];
      const products = await prisma.product.findMany({
        where:  { id: { in: uniqueProductIds }, tenantId },
        select: { id: true, categoryId: true },
      });
      for (const p of products) {
        productCategoryMap.set(p.id, p.categoryId ?? null);
      }
    }

    const cartItemsForEngine: CampaignCartItem[] = items.map((item) => ({
      productId:  item.productId,
      variantId:  item.variantId,
      quantity:   item.quantity,
      price:      item.price,
      categoryId: productCategoryMap.get(item.productId) ?? undefined,
    }));

    const campaignSvc    = new CampaignService();
    const campaignResult = await campaignSvc.applyToCart(cartItemsForEngine, tenantId);

    // Build a per-item discount lookup indexed by productId|variantId
    // ItemBreakdown uses unitDiscount * quantity to get line-level discount
    const itemDiscountMap = new Map<string, number>();
    for (const bd of campaignResult.itemBreakdown ?? []) {
      const key         = `${bd.productId}|${bd.variantId ?? ''}`;
      const lineDiscount = bd.unitDiscount * bd.quantity;
      itemDiscountMap.set(key, (itemDiscountMap.get(key) ?? 0) + lineDiscount);
    }

    // savings = originalTotal - finalPrice
    const campaignDiscount = campaignResult.savings ?? 0;

    // ── Coupon validation (outside transaction — read-only check) ──────────
    let couponId:       string | null = null;
    let couponDiscount  = 0;

    // Apply coupon on the already-campaign-discounted total
    const afterCampaignTotal = Math.max(0, subtotal - campaignDiscount);

    if (couponCode?.trim()) {
      const couponSvc = new CouponService();
      const validation = await couponSvc.validate(
        couponCode.trim(),
        afterCampaignTotal,
        tenantId,
        customerId,
      );

      if (!validation.valid) {
        throw new Error(validation.error ?? 'Geçersiz kupon kodu.');
      }

      couponId       = validation.coupon!.id;
      couponDiscount = validation.discountAmount;
    }

    // Kupon limitleri — transaction dışında (yalnızca okuma; yazma tx içinde kalır)
    if (couponId) {
      const couponRow = await prisma.coupon.findUnique({
        where:  { id: couponId },
        select: {
          id: true,
          isActive: true,
          startsAt: true,
          expiresAt: true,
          usageCount: true,
          usageLimit: true,
          usageLimitPerCustomer: true,
        },
      });
      if (!couponRow?.isActive) {
        throw new Error('Kupon artık aktif değil.');
      }
      const now = new Date();
      if (couponRow.startsAt && new Date(couponRow.startsAt) > now) {
        throw new Error('Kupon henüz geçerli değil.');
      }
      if (couponRow.expiresAt && new Date(couponRow.expiresAt) < now) {
        throw new Error('Kuponun süresi dolmuş.');
      }
      if (couponRow.usageLimit != null && couponRow.usageCount >= couponRow.usageLimit) {
        throw new Error('Kupon kullanım limiti dolmuş.');
      }
      if (couponRow.usageLimitPerCustomer != null) {
        const perCustomer = await prisma.order.count({
          where: {
            tenantId,
            couponId,
            customerId,
            status: { not: 'CANCELLED' },
          },
        });
        if (perCustomer >= couponRow.usageLimitPerCustomer) {
          throw new Error('Bu kuponu kullanım limitinize ulaştınız.');
        }
      }
    }

    const totalDiscount = campaignDiscount + couponDiscount;
    const shipping      = Math.max(0, Number(shippingPrice) || 0);
    const extras        = Math.max(0, Number(extraFees) || 0);
    const totalAmount   = Math.max(0, subtotal - totalDiscount + shipping + extras);
    const orderNumber   = `ORD-${Date.now()}`;

    const txResult = await prisma.$transaction(async (tx) => {
      await deductStock(tx, items, tenantId);

      if (couponId) {
        const coupon = await tx.coupon.findUnique({
          where:  { id: couponId },
          select: { id: true, usageCount: true, usageLimit: true, isActive: true },
        });
        if (!coupon?.isActive) {
          throw new Error('Kupon artık aktif değil.');
        }
        if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) {
          throw new Error('Kupon kullanım limiti dolmuş.');
        }
        await tx.coupon.update({
          where: { id: couponId },
          data:  { usageCount: { increment: 1 } },
        });
      }

      const created = await tx.order.create({
        data: {
          orderNumber,
          totalAmount,
          shippingPrice:    shipping,
          discountAmount:   couponDiscount,
          campaignDiscount,
          currency,
          notes,
          status:   'PENDING',
          ...(paymentProvider ? { paymentProvider } : {}),
          paymentStatus: paymentStatus
            ?? (paymentProvider ? initialOrderPaymentStatus(paymentProvider) : 'PENDING'),
          tenant:   { connect: { id: tenantId } },
          customer: { connect: { id: customerId } },
          ...(couponId ? { coupon: { connect: { id: couponId } } } : {}),
          items: {
            create: items.map((item) => {
              const key          = `${item.productId}|${item.variantId ?? ''}`;
              const itemDiscount = itemDiscountMap.get(key) ?? 0;
              return {
                quantity:       item.quantity,
                price:          item.price,
                discountAmount: itemDiscount,
                product:  { connect: { id: item.productId } },
                ...(item.variantId
                  ? { variant: { connect: { id: item.variantId } } }
                  : {}),
              };
            }),
          },
        },
        select: { id: true },
      });

      return { orderId: created.id };
    }, { maxWait: 10_000, timeout: 20_000 });

    const order = await prisma.order.findFirst({
      where:   { id: txResult.orderId, tenantId },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new Error('Sipariş oluşturuldu ancak kayıt okunamadı.');
    }

    logTenantUsage(tenantId, TenantUsageAction.ORDER_CREATE);
    return {
      order,
      summary: {
        originalTotal:    subtotal,
        campaignDiscount,
        couponDiscount,
        totalDiscount,
        finalTotal:       totalAmount,
      },
      appliedCampaigns: campaignResult.discounts ?? [],
    };
  }

  // ── Update Status ─────────────────────────────────────────────────────────

  async updateStatus(
    id: string,
    newStatus: string,
    tenantId: string,
    options?: OrderStatusUpdateOptions,
  ) {
    const { order, oldStatus } = await prisma.$transaction(async (tx) => {
      // Fetch current order — fail fast if not found / wrong tenant
      const existing = await tx.order.findFirst({
        where:  { id, tenantId },
        select: { id: true, status: true, shippedAt: true },
      });

      if (!existing) {
        throw new Error('Sipariş bulunamadı veya bu tenant\'a ait değil.');
      }

      const oldStatus = String(existing.status);

      // ── Stock side-effects ────────────────────────────────────────
      if (newStatus === CANCELLED_STATUS && oldStatus !== CANCELLED_STATUS) {
        // Cancelling an active order → restore all stock
        await restoreStock(tx, id);
      } else if (oldStatus === CANCELLED_STATUS && newStatus !== CANCELLED_STATUS) {
        // Re-activating a cancelled order → re-deduct stock
        // Fetch items with enough detail for deductStock
        const orderItems = await tx.orderItem.findMany({
          where:  { orderId: id },
          select: { productId: true, variantId: true, quantity: true, price: true },
        });

        await deductStock(
          tx,
          orderItems.map((i) => ({
            productId: i.productId,
            variantId: i.variantId ?? undefined,
            quantity:  i.quantity,
            price:     Number(i.price),
          })),
          tenantId,
        );
      }
      // For all other transitions (PENDING → PAID → SHIPPED → DELIVERED)
      // stock is not touched; it was already reserved on creation.

      const statusData: Prisma.OrderUpdateInput = { status: newStatus as any };
      if (newStatus === 'SHIPPED' && !existing.shippedAt) {
        statusData.shippedAt = new Date();
      }

      const order = await tx.order.update({
        where:   { id },
        data:    statusData,
        include: ORDER_INCLUDE,
      });

      return { order, oldStatus };
    });

    if (options?.notifyCustomer === true) {
      const paymentProvider = resolveOrderPaymentProvider(order);
      if (shouldSendBankTransferPaymentApproved(paymentProvider, oldStatus, newStatus, {
        bankTransferApprovedEmailSentAt: order.bankTransferApprovedEmailSentAt,
        paymentStatus:                   order.paymentStatus,
      })) {
        void storeEmailService.notifyBankTransferPaymentApproved(tenantId, id, { newStatus });
      } else if (
        shouldSendCustomerStatusEmail(true, oldStatus, newStatus, paymentProvider, {
          shippingNotificationSentAt: order.shippingNotificationSentAt,
        })
      ) {
        void storeEmailService.notifyOrderStatusUpdated(tenantId, id, oldStatus, newStatus);
      }
    }

    return order;
  }

  /** Toplu durum güncelleme — yalnızca tenant’a ait siparişler; tekil updateStatus kullanır. */
  async bulkUpdateStatus(
    tenantId: string,
    orderIds: string[],
    newStatus: string,
    options?: OrderStatusUpdateOptions,
  ): Promise<{
    updatedCount: number;
    skippedIds: string[];
    updated: Array<{ id: string; orderNumber: string; previousStatus: string }>;
    failures: Array<{ id: string; error: string }>;
  }> {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      throw Object.assign(new Error('En az bir sipariş seçilmelidir.'), { statusCode: 400 });
    }

    const uniqueIds = [...new Set(orderIds.map((id) => String(id).trim()).filter(Boolean))];
    if (uniqueIds.length === 0) {
      throw Object.assign(new Error('En az bir sipariş seçilmelidir.'), { statusCode: 400 });
    }

    const rows = await prisma.order.findMany({
      where: { id: { in: uniqueIds }, tenantId },
      select: { id: true, orderNumber: true, status: true },
    });

    const foundIds = new Set(rows.map((r) => r.id));
    const skippedIds = uniqueIds.filter((id) => !foundIds.has(id));

    const updated: Array<{ id: string; orderNumber: string; previousStatus: string }> = [];
    const failures: Array<{ id: string; error: string }> = [];

    for (const row of rows) {
      const previousStatus = String(row.status);
      if (previousStatus === newStatus) {
        continue;
      }
      try {
        const order = await this.updateStatus(row.id, newStatus, tenantId, options);
        updated.push({
          id:               row.id,
          orderNumber:      order.orderNumber,
          previousStatus,
        });
        void order;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Durum güncellenemedi.';
        failures.push({ id: row.id, error: msg });
      }
    }

    return {
      updatedCount: updated.length,
      skippedIds,
      updated,
      failures,
    };
  }

  // ── Shipping info (admin) ─────────────────────────────────────────────────

  async updateShipping(
    id: string,
    tenantId: string,
    input: OrderShippingInput & { markAsShipped?: boolean },
  ) {
    const shipping = normalizeShippingInput(input);

    const existing = await prisma.order.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });

    if (!existing) {
      throw new Error('Sipariş bulunamadı veya bu tenant\'a ait değil.');
    }

    await prisma.order.update({
      where: { id },
      data:  shipping,
    });

    if (input.markAsShipped) {
      if (existing.status === 'SHIPPED') {
        return this.getById(id, tenantId);
      }
      return this.updateStatus(id, 'SHIPPED', tenantId, { notifyCustomer: true });
    }

    return this.getById(id, tenantId);
  }

  // ── Store order invoice info (admin) ──────────────────────────────────────

  async updateInvoice(id: string, tenantId: string, input: OrderInvoiceInput) {
    const existing = await prisma.order.findFirst({
      where: { id, tenantId },
      select: {
        id:                true,
        invoiceUrl:        true,
        invoiceUploadedAt: true,
      },
    });

    if (!existing) {
      throw new Error('Sipariş bulunamadı veya bu tenant\'a ait değil.');
    }

    const data: Prisma.OrderUpdateInput = {};

    if (input.invoiceNumber !== undefined) {
      data.invoiceNumber = normalizeInvoiceNumber(input.invoiceNumber);
    }

    if (input.invoiceUrl !== undefined) {
      const invoiceUrl = normalizeInvoiceUrl(input.invoiceUrl);
      data.invoiceUrl = invoiceUrl;
      if (invoiceUrl) {
        data.invoiceUploadedAt =
          existing.invoiceUrl !== invoiceUrl || !existing.invoiceUploadedAt
            ? new Date()
            : existing.invoiceUploadedAt;
      } else {
        data.invoiceUploadedAt = null;
      }
    }

    await prisma.order.update({
      where: { id },
      data,
    });

    return this.getById(id, tenantId);
  }

  // ── Confirm bank transfer payment (admin) ─────────────────────────────────

  async confirmPayment(id: string, tenantId: string) {
    const existing = await prisma.order.findFirst({
      where: { id, tenantId },
      include: ORDER_INCLUDE,
    });

    if (!existing) {
      throw new Error('Sipariş bulunamadı veya bu tenant\'a ait değil.');
    }

    const paymentProvider = resolveOrderPaymentProvider(existing);
    if (!isBankTransferProvider(paymentProvider)) {
      throw Object.assign(
        new Error('Yalnızca havale/EFT siparişlerinde ödeme onaylanabilir.'),
        { statusCode: 422 },
      );
    }

    if (String(existing.status) === CANCELLED_STATUS) {
      throw Object.assign(
        new Error('İptal edilmiş siparişte ödeme onaylanamaz.'),
        { statusCode: 422 },
      );
    }

    if (!isBankTransferPaymentAwaitingConfirm(existing.paymentStatus)) {
      throw Object.assign(
        new Error('Bu siparişin ödemesi zaten onaylanmış veya onaylanamaz durumda.'),
        { statusCode: 422 },
      );
    }

    const oldStatus = String(existing.status);
    const newStatus = oldStatus === 'PENDING' ? 'PROCESSING' : oldStatus;
    const now = new Date();

    const order = await prisma.order.update({
      where: { id },
      data: {
        paymentStatus:     'PAID',
        paymentApprovedAt: now,
        ...(newStatus !== oldStatus ? { status: newStatus as OrderStatus } : {}),
      },
      include: ORDER_INCLUDE,
    });

    if (!existing.bankTransferApprovedEmailSentAt) {
      void storeEmailService.notifyBankTransferPaymentApproved(tenantId, id, { newStatus: 'PAID' });
    }

    return order;
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async delete(id: string, tenantId: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({
        where:  { id, tenantId },
        select: { id: true, status: true },
      });

      if (!existing) throw new Error('Sipariş bulunamadı.');

      // If order was not yet cancelled, restore stock before hard-delete
      if (String(existing.status) !== CANCELLED_STATUS) {
        await restoreStock(tx, id);
      }

      return tx.order.delete({ where: { id } });
    });
  }

  // ── By customer ───────────────────────────────────────────────────────────

  async getByCustomer(customerId: string, tenantId: string) {
    return prisma.order.findMany({
      where:   { customerId, tenantId },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── History (audit-based) ───────────────────────────────────────────────

  async getHistory(id: string, tenantId: string) {
    const order = await prisma.order.findFirst({
      where:  { id, tenantId },
      select: { id: true },
    });
    if (!order) return null;

    const logs = await auditService.getTargetHistory(tenantId, 'Order', id);
    return mapAuditLogsToOrderHistory(logs);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async getStats(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      storefrontCount,
      trendyolCount,
      storefrontPending,
      trendyolPending,
      storefrontPaid,
      todayRevenue,
    ] = await Promise.all([
      prisma.order.count({ where: { tenantId } }),
      prisma.trendyolOrder.count({ where: { tenantId } }),
      prisma.order.count({
        where: { tenantId, status: { in: ['PENDING', 'PROCESSING'] } },
      }),
      prisma.trendyolOrder.count({
        where: { tenantId, status: { in: ['Created', 'Picking'] } },
      }),
      prisma.order.count({ where: { tenantId, status: 'PAID' } }),
      prisma.order.aggregate({
        where: {
          tenantId,
          createdAt: { gte: today },
          status:    { in: ['PAID', 'DELIVERED'] },
        },
        _sum: { totalAmount: true },
      }),
    ]);

    const totalCount = storefrontCount + trendyolCount;
    const pending    = storefrontPending + trendyolPending;

    return {
      total:           totalCount,
      pending,
      paid:            storefrontPaid,
      todayRevenue:    Number(todayRevenue._sum.totalAmount ?? 0),
      storefrontCount,
      trendyolCount,
      totalCount,
      storefrontPending,
      trendyolPending,
    };
  }
}
