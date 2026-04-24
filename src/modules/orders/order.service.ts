import { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../../config/database';
import { CouponService, calcDiscount } from '../coupons/coupon.service';
import { CampaignService, CartItem as CampaignCartItem } from '../campaigns/campaign.service';

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
}

export interface GetAllOrdersQuery {
  page?:   number;
  limit?:  number;
  status?: string;
  search?: string;
}

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
    const { page = 1, limit = 20, status, search } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Prisma.OrderWhereInput = { tenantId };

    if (status) {
      where.status = status.toUpperCase() as any;
    }

    if (search?.trim()) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        {
          customer: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName:  { contains: search, mode: 'insensitive' } },
              { email:     { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

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

  // ── Single ───────────────────────────────────────────────────────────────

  async getById(id: string, tenantId: string) {
    return prisma.order.findFirst({
      where:   { id, tenantId },
      include: ORDER_INCLUDE,
    });
  }

  // ── Create ───────────────────────────────────────────────────────────────

  async create(data: CreateOrderDto, tenantId: string) {
    const { customerId, items, notes, currency = 'TRY', couponCode } = data;

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

    return prisma.$transaction(async (tx) => {
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
      const totalAmount   = Math.max(0, subtotal - totalDiscount);
      const orderNumber   = `ORD-${Date.now()}`;

      // 3. Create the order + items (with per-item discount amounts)
      const order = await tx.order.create({
        data: {
          orderNumber,
          totalAmount,
          discountAmount:   couponDiscount,
          campaignDiscount,
          currency,
          notes,
          status:   'PENDING',
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
  }

  // ── Update Status ─────────────────────────────────────────────────────────

  async updateStatus(id: string, newStatus: string, tenantId: string) {
    return prisma.$transaction(async (tx) => {
      // Fetch current order — fail fast if not found / wrong tenant
      const existing = await tx.order.findFirst({
        where:  { id, tenantId },
        select: { id: true, status: true },
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

      return tx.order.update({
        where:   { id },
        data:    { status: newStatus as any },
        include: ORDER_INCLUDE,
      });
    });
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

    const [total, pending, paid, todayRevenue] = await prisma.$transaction([
      prisma.order.count({ where: { tenantId } }),
      prisma.order.count({ where: { tenantId, status: 'PENDING' } }),
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

    return {
      total,
      pending,
      paid,
      todayRevenue: Number(todayRevenue._sum.totalAmount ?? 0),
    };
  }
}
