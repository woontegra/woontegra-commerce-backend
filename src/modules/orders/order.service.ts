import { Prisma, PrismaClient, TenantUsageAction } from '@prisma/client';
import prisma from '../../config/database';
import { logTenantUsage } from '../../services/tenantUsageLog.service';
import { CouponService, calcDiscount } from '../coupons/coupon.service';
import { CampaignService, CartItem as CampaignCartItem } from '../campaigns/campaign.service';
import {
  shouldSendBankTransferPaymentApproved,
  shouldSendCustomerStatusEmail,
} from '../email/templates/store-email.util';
import {
  initialOrderPaymentStatus,
  resolveOrderPaymentProvider,
} from './order-payment.util';
import { normalizeShippingInput, type OrderShippingInput } from './order-shipping.util';
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

    // ── Customer tenant isolation check ───────────────────────────────────
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!customer) {
      throw new Error('Müşteri bulunamadı veya bu hesaba ait değil.');
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
      const validation = await couponSvc.validate(couponCode.trim(), afterCampaignTotal, tenantId);

      if (!validation.valid) {
        throw new Error(validation.error ?? 'Geçersiz kupon kodu.');
      }

      couponId      = validation.coupon!.id;
      couponDiscount = validation.discountAmount;
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Deduct stock — throws StockError on failure
      await deductStock(tx, items, tenantId);

      // 2. If coupon used — verify it's still valid (race condition guard)
      //    and atomically increment usageCount
      if (couponId) {
        const coupon = await tx.coupon.findUnique({
          where:  { id: couponId },
          select: { id: true, usageCount: true, usageLimit: true, isActive: true, expiresAt: true },
        });

        if (!coupon || !coupon.isActive) {
          throw new Error('Kupon artık aktif değil.');
        }
        if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
          throw new Error('Kuponun süresi dolmuş.');
        }
        if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) {
          throw new Error('Kupon kullanım limiti dolmuş.');
        }

        await tx.coupon.update({
          where: { id: couponId },
          data:  { usageCount: { increment: 1 } },
        });
      }

      const totalDiscount = campaignDiscount + couponDiscount;
      const shipping      = Math.max(0, Number(shippingPrice) || 0);
      const extras        = Math.max(0, Number(extraFees) || 0);
      const totalAmount   = Math.max(0, subtotal - totalDiscount + shipping + extras);
      const orderNumber   = `ORD-${Date.now()}`;

      // 3. Create the order + items (with per-item discount amounts)
      const order = await tx.order.create({
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
              const key            = `${item.productId}|${item.variantId ?? ''}`;
              const itemDiscount   = itemDiscountMap.get(key) ?? 0;
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
        include: ORDER_INCLUDE,
      });

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
    });

    logTenantUsage(tenantId, TenantUsageAction.ORDER_CREATE);
    return result;
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
