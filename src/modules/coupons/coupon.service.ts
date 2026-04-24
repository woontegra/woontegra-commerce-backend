import { Prisma } from '@prisma/client';
import prisma from '../../config/database';

// ── Types ──────────────────────────────────────────────────────────────────

export type CouponDiscountType = 'PERCENTAGE' | 'FIXED';

export interface CreateCouponDto {
  code:           string;
  discountType:   CouponDiscountType;
  value:          number;          // % or TRY
  minOrderAmount?: number;         // min order to be eligible
  maxDiscount?:   number;          // cap for percentage discounts
  usageLimit?:    number | null;   // null = unlimited
  isActive?:      boolean;
  expiresAt?:     string | null;
}

export interface GetCouponsQuery {
  page?:   number;
  limit?:  number;
  active?: 'true' | 'false';
  search?: string;
}

export interface CouponValidationResult {
  valid:          boolean;
  coupon:         ShapedCoupon | null;
  discountAmount: number;
  finalAmount:    number;
  error?:         string;
}

export interface ShapedCoupon {
  id:             string;
  code:           string;
  discountType:   CouponDiscountType;
  value:          number;
  minOrderAmount: number | null;
  maxDiscount:    number | null;
  usageLimit:     number | null;
  usageCount:     number;
  isActive:       boolean;
  expiresAt:      string | null;
  createdAt:      string;
  updatedAt:      string;
  remaining:      number | null;
  isExpired:      boolean;
}

// ── Shape helper ────────────────────────────────────────────────────────────

function shape(c: any): ShapedCoupon {
  const usageLimit   = c.usageLimit  != null ? Number(c.usageLimit)  : null;
  const usageCount   = Number(c.usageCount ?? 0);
  const isExpired    = c.expiresAt ? new Date(c.expiresAt) < new Date() : false;
  const remaining    = usageLimit != null ? Math.max(0, usageLimit - usageCount) : null;

  return {
    id:             c.id,
    code:           c.code,
    discountType:   c.discountType as CouponDiscountType,
    value:          Number(c.value),
    minOrderAmount: c.minOrderAmount != null ? Number(c.minOrderAmount) : null,
    maxDiscount:    c.maxDiscount    != null ? Number(c.maxDiscount)    : null,
    usageLimit,
    usageCount,
    isActive:       c.isActive,
    expiresAt:      c.expiresAt  ? new Date(c.expiresAt).toISOString()  : null,
    createdAt:      new Date(c.createdAt).toISOString(),
    updatedAt:      new Date(c.updatedAt).toISOString(),
    remaining,
    isExpired,
  };
}

// ── Discount calculation ────────────────────────────────────────────────────

export function calcDiscount(
  coupon: ShapedCoupon,
  orderAmount: number,
): number {
  let discount = 0;

  if (coupon.discountType === 'PERCENTAGE') {
    discount = orderAmount * (coupon.value / 100);
    if (coupon.maxDiscount != null) {
      discount = Math.min(discount, coupon.maxDiscount);
    }
  } else {
    discount = Math.min(coupon.value, orderAmount);
  }

  return Math.round(discount * 100) / 100; // 2 decimal precision
}

// ── Service ────────────────────────────────────────────────────────────────

export class CouponService {
  // ── List ────────────────────────────────────────────────────────────────

  async getAll(tenantId: string, query: GetCouponsQuery = {}) {
    const { page = 1, limit = 20, active, search } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Prisma.CouponWhereInput = { tenantId };

    if (active === 'true')  where.isActive = true;
    if (active === 'false') where.isActive = false;

    if (search?.trim()) {
      where.code = { contains: search.trim(), mode: 'insensitive' };
    }

    const [total, raw] = await prisma.$transaction([
      prisma.coupon.count({ where }),
      prisma.coupon.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: Number(limit),
      }),
    ]);

    return {
      coupons:    raw.map(shape),
      total,
      page:       Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    };
  }

  // ── Single ───────────────────────────────────────────────────────────────

  async getById(id: string, tenantId: string) {
    const c = await prisma.coupon.findFirst({ where: { id, tenantId } });
    return c ? shape(c) : null;
  }

  // ── Validate by code ─────────────────────────────────────────────────────

  /**
   * Called from client or order creation to check if a coupon is applicable.
   * Does NOT increment usageCount — only validation.
   */
  async validate(
    code:        string,
    orderAmount: number,
    tenantId:    string,
  ): Promise<CouponValidationResult> {
    const raw = await prisma.coupon.findFirst({
      where: { code: { equals: code, mode: 'insensitive' }, tenantId },
    });

    if (!raw) {
      return { valid: false, coupon: null, discountAmount: 0, finalAmount: orderAmount, error: 'Kupon bulunamadı.' };
    }

    const c = shape(raw);

    if (!c.isActive) {
      return { valid: false, coupon: c, discountAmount: 0, finalAmount: orderAmount, error: 'Kupon aktif değil.' };
    }
    if (c.isExpired) {
      return { valid: false, coupon: c, discountAmount: 0, finalAmount: orderAmount, error: 'Kuponun süresi dolmuş.' };
    }
    if (c.usageLimit != null && c.usageCount >= c.usageLimit) {
      return { valid: false, coupon: c, discountAmount: 0, finalAmount: orderAmount, error: 'Kupon kullanım limiti dolmuş.' };
    }
    if (c.minOrderAmount != null && orderAmount < c.minOrderAmount) {
      return {
        valid:          false,
        coupon:         c,
        discountAmount: 0,
        finalAmount:    orderAmount,
        error: `Bu kupon için minimum sipariş tutarı ₺${c.minOrderAmount.toFixed(2)}'dır.`,
      };
    }

    const discountAmount = calcDiscount(c, orderAmount);
    return {
      valid:          true,
      coupon:         c,
      discountAmount,
      finalAmount:    Math.max(0, orderAmount - discountAmount),
    };
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(data: CreateCouponDto, tenantId: string) {
    const code = data.code.trim().toUpperCase();

    if (!code) throw new Error('Kupon kodu zorunludur.');
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      throw new Error('Kupon kodu yalnızca büyük harf, rakam, tire ve alt çizgi içerebilir (3-32 karakter).');
    }
    if (data.value <= 0) throw new Error('İndirim değeri 0\'dan büyük olmalıdır.');
    if (data.discountType === 'PERCENTAGE' && data.value > 100) {
      throw new Error('Yüzde indirimi 100\'ü geçemez.');
    }

    // Code uniqueness is global in schema — check tenant collision first
    const existing = await prisma.coupon.findUnique({ where: { code } });
    if (existing) {
      throw new Error(`"${code}" kodu zaten kullanımda.`);
    }

    const created = await prisma.coupon.create({
      data: {
        code,
        discountType:   data.discountType,
        value:          data.value,
        minOrderAmount: data.minOrderAmount ?? null,
        maxDiscount:    data.maxDiscount    ?? null,
        usageLimit:     data.usageLimit     ?? null,
        isActive:       data.isActive       ?? true,
        expiresAt:      data.expiresAt      ? new Date(data.expiresAt) : null,
        tenant:         { connect: { id: tenantId } },
      },
    });

    return shape(created);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(id: string, data: Partial<CreateCouponDto>, tenantId: string) {
    const existing = await prisma.coupon.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Kupon bulunamadı.');

    const updateData: any = {};
    if (data.discountType   !== undefined) updateData.discountType   = data.discountType;
    if (data.value          !== undefined) updateData.value          = data.value;
    if (data.minOrderAmount !== undefined) updateData.minOrderAmount = data.minOrderAmount;
    if (data.maxDiscount    !== undefined) updateData.maxDiscount    = data.maxDiscount;
    if (data.usageLimit     !== undefined) updateData.usageLimit     = data.usageLimit;
    if (data.isActive       !== undefined) updateData.isActive       = data.isActive;
    if (data.expiresAt      !== undefined) {
      updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    }

    const updated = await prisma.coupon.update({ where: { id }, data: updateData });
    return shape(updated);
  }

  // ── Toggle active ─────────────────────────────────────────────────────────

  async toggle(id: string, tenantId: string) {
    const existing = await prisma.coupon.findFirst({
      where:  { id, tenantId },
      select: { id: true, isActive: true },
    });
    if (!existing) throw new Error('Kupon bulunamadı.');

    const updated = await prisma.coupon.update({
      where: { id },
      data:  { isActive: !existing.isActive },
    });
    return shape(updated);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async delete(id: string, tenantId: string) {
    const existing = await prisma.coupon.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Kupon bulunamadı.');
    return prisma.coupon.delete({ where: { id } });
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async getStats(tenantId: string) {
    const now = new Date();
    const [total, active, expired] = await prisma.$transaction([
      prisma.coupon.count({ where: { tenantId } }),
      prisma.coupon.count({ where: { tenantId, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      prisma.coupon.count({ where: { tenantId, expiresAt: { lt: now } } }),
    ]);

    const usageSums = await prisma.coupon.aggregate({
      where: { tenantId },
      _sum:  { usageCount: true },
    });

    return {
      total,
      active,
      expired,
      inactive:   total - active - expired,
      totalUsage: Number(usageSums._sum.usageCount ?? 0),
    };
  }
}
