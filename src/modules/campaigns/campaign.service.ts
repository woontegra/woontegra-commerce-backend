/**
 * Campaign Service — Rule-Based Engine
 *
 * Campaign  →  CampaignRule[]
 *   type: PRODUCT_DISCOUNT | CART_DISCOUNT | BUY_X_GET_Y | BULK_DISCOUNT
 *   conditions: { productId?, categoryId?, minCartTotal?, minQty?, tiers? }
 *   actions:    { discountType?, value?, freeQty?, freeProductId?, maxDiscount? }
 */

import { Prisma, CampaignRuleType } from '@prisma/client';
import prisma from '../../config/database';

// ── Public types (shared with controller + frontend) ─────────────────────────

export type LegacyCampaignType = 'percentage' | 'fixed';

export interface CreateCampaignDto {
  name:        string;
  description?: string;
  startDate:   string;
  endDate:     string;
  isActive?:   boolean;
  priority?:   number;
  // legacy simple fields (kept for backward-compat quick creation)
  type?:        LegacyCampaignType;
  value?:       number;
  maxDiscount?: number;
}

export interface CreateRuleDto {
  type:       CampaignRuleType;
  conditions: Record<string, any>;
  actions:    Record<string, any>;
  priority?:  number;
  isActive?:  boolean;
}

export interface GetCampaignsQuery {
  page?:   number;
  limit?:  number;
  active?: 'true' | 'false';
  search?: string;
}

// ── Cart engine types ─────────────────────────────────────────────────────────

export interface CartItem {
  productId:  string;
  variantId?: string | null;
  quantity:   number;
  price:      number;  // unit price (TRY)
  categoryId?: string | null;
}

export interface DiscountLine {
  campaignId:    string;
  campaignName:  string;
  ruleId:        string;
  ruleType:      CampaignRuleType;
  description:   string;
  discountAmount: number;
  freeQty?:      number;
  affectedProductIds: string[];
}

export interface ItemBreakdown {
  productId:      string;
  variantId:      string | null;
  quantity:       number;
  originalPrice:  number;
  unitDiscount:   number;
  finalUnitPrice: number;
  lineTotal:      number;
  appliedRule:    string | null;
}

export interface ApplyCartResult {
  originalTotal:  number;
  finalPrice:     number;
  savings:        number;
  discounts:      DiscountLine[];
  itemBreakdown:  ItemBreakdown[];
}

// Legacy single-price result
export interface PriceCalcResult {
  originalPrice:   number;
  discountedPrice: number;
  discountAmount:  number;
  discountPct:     number;
  campaign: { id: string; name: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function legacyType(prismaType: string): LegacyCampaignType {
  return prismaType === 'PERCENTAGE_DISCOUNT' ? 'percentage' : 'fixed';
}

function shapeCampaign(c: any) {
  const now = new Date();
  return {
    id:           c.id,
    tenantId:     c.tenantId,
    name:         c.name,
    description:  c.description ?? null,
    isActive:     c.isActive,
    priority:     c.priority,
    startDate:    c.startDate,
    endDate:      c.endDate,
    usageCount:   c.currentUsage,
    usageLimit:   c.usageLimit ?? null,
    createdAt:    c.createdAt,
    updatedAt:    c.updatedAt,
    // derived state
    isExpired:    new Date(c.endDate) < now,
    isScheduled:  new Date(c.startDate) > now,
    isRunning:    c.isActive && new Date(c.startDate) <= now && new Date(c.endDate) >= now,
    // rule list
    rules:        (c.campaignRules ?? []).map(shapeRule),
    // legacy fields (for backward compat)
    type:         legacyType(c.discountType),
    value:        c.discountType === 'PERCENTAGE_DISCOUNT' ? (c.discountPercentage ?? 0) : Number(c.discountAmount ?? 0),
    maxDiscount:  c.maxDiscount != null ? Number(c.maxDiscount) : null,
  };
}

function shapeRule(r: any) {
  return {
    id:         r.id,
    campaignId: r.campaignId,
    type:       r.type as CampaignRuleType,
    conditions: r.conditions,
    actions:    r.actions,
    priority:   r.priority,
    isActive:   r.isActive,
    createdAt:  r.createdAt,
    updatedAt:  r.updatedAt,
  };
}

const CAMPAIGN_INCLUDE: Prisma.CampaignInclude = {
  campaignRules: {
    where:   { isActive: true },
    orderBy: { priority: 'desc' },
  },
};

// ── Engine core ───────────────────────────────────────────────────────────────

/**
 * Compute discount amount a single rule gives to a single cart item.
 * Returns null if the rule doesn't apply to this item.
 */
// ── Scope-aware item matching ─────────────────────────────────────────────────
/**
 * Checks whether a cart item matches a rule's scope conditions.
 * Handles the new scope field (ALL | PRODUCT | CATEGORY) produced by the ScopeSelector,
 * as well as legacy conditions that may have productId/categoryId without a scope field.
 */
function matchesItemScope(cond: Record<string, any>, item: CartItem, debugLabel = ''): boolean {
  const scope = (cond.scope ?? '') as string;

  // ── Explicit scope ──────────────────────────────────────────────────────────
  if (scope === 'ALL' || scope === '') {
    // Scope=ALL (or no scope set at all) → always matches
    console.debug(`[Campaign] ${debugLabel} scope=ALL → match`);
    return true;
  }

  if (scope === 'PRODUCT') {
    if (!cond.productId) {
      console.debug(`[Campaign] ${debugLabel} scope=PRODUCT but no productId → match all`);
      return true;
    }
    const ok = cond.productId === item.productId;
    if (!ok) console.debug(`[Campaign] ${debugLabel} scope=PRODUCT mismatch: expected ${cond.productId} got ${item.productId}`);
    return ok;
  }

  if (scope === 'CATEGORY') {
    if (!cond.categoryId) {
      console.debug(`[Campaign] ${debugLabel} scope=CATEGORY but no categoryId → match all`);
      return true;
    }
    const ok = cond.categoryId === item.categoryId;
    if (!ok) console.debug(`[Campaign] ${debugLabel} scope=CATEGORY mismatch: expected ${cond.categoryId} got ${String(item.categoryId)}`);
    return ok;
  }

  // ── Legacy: no scope field, check individual fields (backward compat) ───────
  const matchProduct  = !cond.productId  || cond.productId  === item.productId;
  const matchVariant  = !cond.variantId  || cond.variantId  === item.variantId;
  const matchCategory = !cond.categoryId || cond.categoryId === item.categoryId;
  if (!matchProduct)  console.debug(`[Campaign] ${debugLabel} legacy product mismatch`);
  if (!matchVariant)  console.debug(`[Campaign] ${debugLabel} legacy variant mismatch`);
  if (!matchCategory) console.debug(`[Campaign] ${debugLabel} legacy category mismatch`);
  return matchProduct && matchVariant && matchCategory;
}

// ── Cart aggregation ──────────────────────────────────────────────────────────
/**
 * Merges rows with the same productId + variantId (e.g., same product added twice).
 * Preserves first-seen categoryId and unit price.
 */
function aggregateCart(items: CartItem[]): CartItem[] {
  const map = new Map<string, CartItem>();
  for (const item of items) {
    const key = `${item.productId}|${item.variantId ?? ''}`;
    if (map.has(key)) {
      const e = map.get(key)!;
      map.set(key, { ...e, quantity: e.quantity + item.quantity });
    } else {
      map.set(key, { ...item });
    }
  }
  return Array.from(map.values());
}

// ── Per-item discount calculator ──────────────────────────────────────────────
function computeItemDiscount(
  rule: { type: CampaignRuleType; conditions: any; actions: any },
  item: CartItem,
  debugLabel = '',
): number | null {
  const cond = rule.conditions as Record<string, any>;
  const act  = rule.actions   as Record<string, any>;

  switch (rule.type) {
    case 'PRODUCT_DISCOUNT': {
      if (!matchesItemScope(cond, item, `${debugLabel} PRODUCT_DISCOUNT`)) return null;

      const lineTotal = item.price * item.quantity;
      if (act.discountType === 'percentage') {
        const pct = Math.min(Number(act.value ?? 0), 100);
        const raw = lineTotal * (pct / 100);
        const result = act.maxDiscount ? Math.min(raw, Number(act.maxDiscount)) : raw;
        console.debug(`[Campaign] ${debugLabel} PRODUCT_DISCOUNT %${pct} → ₺${result.toFixed(2)}`);
        return result;
      } else {
        const result = Math.min(Number(act.value ?? 0) * item.quantity, lineTotal);
        console.debug(`[Campaign] ${debugLabel} PRODUCT_DISCOUNT fixed → ₺${result.toFixed(2)}`);
        return result;
      }
    }

    case 'BULK_DISCOUNT': {
      if (!matchesItemScope(cond, item, `${debugLabel} BULK_DISCOUNT`)) return null;

      const minQty = Number(cond.minQty ?? 1);
      if (item.quantity < minQty) {
        console.debug(`[Campaign] ${debugLabel} BULK_DISCOUNT skipped: qty ${item.quantity} < minQty ${minQty}`);
        return null;
      }

      const lineTotal = item.price * item.quantity;
      if (act.discountType === 'percentage') {
        const pct = Math.min(Number(act.value ?? 0), 100);
        const result = lineTotal * (pct / 100);
        console.debug(`[Campaign] ${debugLabel} BULK_DISCOUNT %${pct} → ₺${result.toFixed(2)}`);
        return result;
      } else {
        const result = Math.min(Number(act.value ?? 0) * item.quantity, lineTotal);
        console.debug(`[Campaign] ${debugLabel} BULK_DISCOUNT fixed → ₺${result.toFixed(2)}`);
        return result;
      }
    }

    case 'BUY_X_GET_Y': {
      if (!matchesItemScope(cond, item, `${debugLabel} BUY_X_GET_Y`)) return null;

      const minQty = Number(cond.minQty ?? 1);
      if (item.quantity < minQty) {
        console.debug(`[Campaign] ${debugLabel} BUY_X_GET_Y skipped: qty ${item.quantity} < minQty ${minQty}`);
        return null;
      }

      const freeQty   = Number(act.freeQty ?? 1);
      const setCount  = Math.floor(item.quantity / minQty);
      const totalFree = Math.min(setCount * freeQty, item.quantity);
      const result    = item.price * totalFree;
      console.debug(`[Campaign] ${debugLabel} BUY_X_GET_Y: ${setCount} sets × ${freeQty} free = ₺${result.toFixed(2)}`);
      return result;
    }

    default:
      return null;
  }
}

/**
 * Compute cart-level discount for CART_DISCOUNT rules.
 * Applied once to the subtotal (after item-level discounts).
 */
function computeCartDiscount(
  rule: { type: CampaignRuleType; conditions: any; actions: any },
  subtotal: number,
  totalQty:  number,
): number | null {
  if (rule.type !== 'CART_DISCOUNT') return null;

  const cond = rule.conditions as Record<string, any>;
  const act  = rule.actions   as Record<string, any>;

  if (cond.minCartTotal && subtotal < Number(cond.minCartTotal)) return null;
  if (cond.minQuantity  && totalQty < Number(cond.minQuantity))  return null;

  if (act.discountType === 'percentage') {
    const pct = Math.min(Number(act.value ?? 0), 100);
    const raw = subtotal * (pct / 100);
    return act.maxDiscount ? Math.min(raw, Number(act.maxDiscount)) : raw;
  } else {
    return Math.min(Number(act.value ?? 0), subtotal);
  }
}

function ruleDescription(rule: { type: CampaignRuleType; conditions: any; actions: any }): string {
  const c = rule.conditions as Record<string, any>;
  const a = rule.actions    as Record<string, any>;

  switch (rule.type) {
    case 'PRODUCT_DISCOUNT':
      return `Ürün indirimi: ${a.discountType === 'percentage' ? `%${a.value}` : `₺${a.value}`}`;
    case 'CART_DISCOUNT': {
      const cond = c.minCartTotal ? `₺${c.minCartTotal} üzeri sepet` : c.minQuantity ? `${c.minQuantity}+ ürün` : 'tüm sepete';
      return `Sepet indirimi (${cond}): ${a.discountType === 'percentage' ? `%${a.value}` : `₺${a.value}`}`;
    }
    case 'BUY_X_GET_Y':
      return `${c.minQty} al ${a.freeQty} bedava`;
    case 'BULK_DISCOUNT':
      return `${c.minQty}+ adet: ${a.discountType === 'percentage' ? `%${a.value}` : `₺${a.value}`} indirim`;
    default:
      return rule.type;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class CampaignService {

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async getAll(tenantId: string, query: GetCampaignsQuery = {}) {
    const { page = 1, limit = 20, active, search } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Prisma.CampaignWhereInput = { tenantId };
    if (active === 'true')  where.isActive = true;
    if (active === 'false') where.isActive = false;
    if (search?.trim()) where.name = { contains: search, mode: 'insensitive' };

    const [total, raw] = await prisma.$transaction([
      prisma.campaign.count({ where }),
      prisma.campaign.findMany({
        where,
        include:  CAMPAIGN_INCLUDE,
        orderBy:  [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: Number(limit),
      }),
    ]);

    return {
      campaigns:  raw.map(shapeCampaign),
      total,
      page:       Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    };
  }

  async getById(id: string, tenantId: string) {
    const c = await prisma.campaign.findFirst({ where: { id, tenantId }, include: CAMPAIGN_INCLUDE });
    if (!c) return null;
    return shapeCampaign(c);
  }

  async getActive(tenantId: string) {
    const now = new Date();
    const raw = await prisma.campaign.findMany({
      where:   { tenantId, isActive: true, startDate: { lte: now }, endDate: { gte: now } },
      include: CAMPAIGN_INCLUDE,
      orderBy: { priority: 'desc' },
    });
    return raw.map(shapeCampaign);
  }

  async create(data: CreateCampaignDto, tenantId: string) {
    const start = new Date(data.startDate);
    const end   = new Date(data.endDate);
    if (isNaN(start.getTime())) throw new Error('Geçersiz başlangıç tarihi.');
    if (isNaN(end.getTime()))   throw new Error('Geçersiz bitiş tarihi.');
    if (end <= start)           throw new Error('Bitiş tarihi başlangıç tarihinden sonra olmalıdır.');

    // Determine legacy discountType for backward compat
    const discountType = data.type === 'fixed' ? 'FIXED_DISCOUNT' : 'PERCENTAGE_DISCOUNT';

    const created = await prisma.campaign.create({
      data: {
        name:               data.name,
        description:        data.description ?? null,
        discountType:       discountType as any,
        discountPercentage: data.type === 'percentage' && data.value ? Math.round(data.value) : null,
        discountAmount:     data.type === 'fixed'      && data.value ? data.value             : null,
        maxDiscount:        data.maxDiscount ?? null,
        rules:              {},
        startDate:          start,
        endDate:            end,
        isActive:           data.isActive ?? true,
        priority:           data.priority ?? 0,
        tenant:             { connect: { id: tenantId } },
      },
      include: CAMPAIGN_INCLUDE,
    });

    return shapeCampaign(created);
  }

  async update(id: string, data: Partial<CreateCampaignDto>, tenantId: string) {
    const existing = await prisma.campaign.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Kampanya bulunamadı.');

    const updateData: any = {};
    if (data.name        !== undefined) updateData.name        = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.isActive    !== undefined) updateData.isActive    = data.isActive;
    if (data.priority    !== undefined) updateData.priority    = data.priority;
    if (data.startDate)                 updateData.startDate   = new Date(data.startDate);
    if (data.endDate)                   updateData.endDate     = new Date(data.endDate);
    if (data.maxDiscount !== undefined) updateData.maxDiscount = data.maxDiscount;

    const updated = await prisma.campaign.update({
      where:   { id },
      data:    updateData,
      include: CAMPAIGN_INCLUDE,
    });
    return shapeCampaign(updated);
  }

  async toggle(id: string, tenantId: string) {
    const existing = await prisma.campaign.findFirst({ where: { id, tenantId }, select: { id: true, isActive: true } });
    if (!existing) throw new Error('Kampanya bulunamadı.');
    const updated = await prisma.campaign.update({
      where:   { id },
      data:    { isActive: !existing.isActive },
      include: CAMPAIGN_INCLUDE,
    });
    return shapeCampaign(updated);
  }

  async delete(id: string, tenantId: string) {
    const existing = await prisma.campaign.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Kampanya bulunamadı.');
    return prisma.campaign.delete({ where: { id } });
  }

  // ── RULE CRUD ─────────────────────────────────────────────────────────────

  async addRule(campaignId: string, tenantId: string, data: CreateRuleDto) {
    // verify ownership
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
    if (!campaign) throw new Error('Kampanya bulunamadı.');

    const rule = await prisma.campaignRule.create({
      data: {
        campaignId,
        type:       data.type,
        conditions: data.conditions,
        actions:    data.actions,
        priority:   data.priority ?? 0,
        isActive:   data.isActive ?? true,
      },
    });
    return shapeRule(rule);
  }

  async updateRule(ruleId: string, campaignId: string, tenantId: string, data: Partial<CreateRuleDto>) {
    // verify ownership via campaign
    const rule = await prisma.campaignRule.findFirst({
      where:   { id: ruleId, campaignId },
      include: { campaign: { select: { tenantId: true } } },
    });
    if (!rule || rule.campaign.tenantId !== tenantId) throw new Error('Kural bulunamadı.');

    const updated = await prisma.campaignRule.update({
      where: { id: ruleId },
      data: {
        type:       data.type       ?? rule.type,
        conditions: data.conditions ?? rule.conditions as any,
        actions:    data.actions    ?? rule.actions    as any,
        priority:   data.priority   ?? rule.priority,
        isActive:   data.isActive   ?? rule.isActive,
      },
    });
    return shapeRule(updated);
  }

  async deleteRule(ruleId: string, campaignId: string, tenantId: string) {
    const rule = await prisma.campaignRule.findFirst({
      where:   { id: ruleId, campaignId },
      include: { campaign: { select: { tenantId: true } } },
    });
    if (!rule || rule.campaign.tenantId !== tenantId) throw new Error('Kural bulunamadı.');
    return prisma.campaignRule.delete({ where: { id: ruleId } });
  }

  // ── CART ENGINE ───────────────────────────────────────────────────────────

  async applyToCart(cartItems: CartItem[], tenantId: string): Promise<ApplyCartResult> {
    if (cartItems.length === 0) {
      return { originalTotal: 0, finalPrice: 0, savings: 0, discounts: [], itemBreakdown: [] };
    }

    // Merge duplicate product+variant rows before applying rules
    const items        = aggregateCart(cartItems);
    const originalTotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const totalQty      = items.reduce((s, i) => s + i.quantity, 0);

    console.debug(`[Campaign] applyToCart: ${items.length} merged items, total=₺${originalTotal.toFixed(2)}`);

    // Load active campaigns with their rules
    const now       = new Date();
    const campaigns = await prisma.campaign.findMany({
      where: {
        tenantId,
        isActive:  true,
        startDate: { lte: now },
        endDate:   { gte: now },
      },
      include: {
        campaignRules: {
          where:   { isActive: true },
          orderBy: { priority: 'desc' },
        },
      },
    });

    console.debug(`[Campaign] Loaded ${campaigns.length} active campaigns`);

    // itemKey helper
    const itemKey = (i: CartItem) => `${i.productId}|${i.variantId ?? ''}`;

    // ── Step 1a: PRODUCT_DISCOUNT — per-item (no qty threshold) ───────────
    type BestMatch = {
      ruleId:        string;
      campaignId:    string;
      campaignName:  string;
      rule:          { type: CampaignRuleType; conditions: any; actions: any };
      discountAmt:   number;
    };
    const itemBest: (BestMatch | null)[] = items.map(() => null);

    for (const campaign of campaigns) {
      for (const rule of campaign.campaignRules) {
        if (rule.type !== 'PRODUCT_DISCOUNT') continue;
        const label = `[${campaign.name}/PRODUCT_DISCOUNT]`;
        items.forEach((item, idx) => {
          const discount = computeItemDiscount(
            { type: rule.type, conditions: rule.conditions, actions: rule.actions },
            item, label,
          );
          if (discount === null || discount <= 0) return;
          const cur = itemBest[idx];
          if (!cur || discount > cur.discountAmt) {
            itemBest[idx] = { ruleId: rule.id, campaignId: campaign.id, campaignName: campaign.name,
              rule: { type: rule.type, conditions: rule.conditions, actions: rule.actions }, discountAmt: discount };
          }
        });
      }
    }

    // ── Step 1b: BULK_DISCOUNT + BUY_X_GET_Y — group-level ────────────────
    // For quantity-threshold rules, the threshold must be met by the SUM of
    // all matching items (e.g., size 38 + 39 + 40 all in the same category).
    const itemDiscountExtra: Map<string, number> = new Map(); // itemKey → extra discount

    for (const campaign of campaigns) {
      for (const rule of campaign.campaignRules) {
        if (rule.type !== 'BULK_DISCOUNT' && rule.type !== 'BUY_X_GET_Y') continue;

        const cond  = rule.conditions as Record<string, any>;
        const act   = rule.actions   as Record<string, any>;
        const label = `[${campaign.name}/${rule.type}]`;

        // Find all cart items that match this rule's scope
        const matching = items.filter(i => matchesItemScope(cond, i, label));
        if (matching.length === 0) {
          console.debug(`${label} skipped: no matching items`);
          continue;
        }

        const groupQty   = matching.reduce((s, i) => s + i.quantity, 0);
        const groupValue = matching.reduce((s, i) => s + i.price * i.quantity, 0);
        const minQty     = Number(cond.minQty ?? 1);

        if (groupQty < minQty) {
          console.debug(`${label} skipped: groupQty=${groupQty} < minQty=${minQty}`);
          continue;
        }

        let totalGroupDiscount = 0;

        if (rule.type === 'BULK_DISCOUNT') {
          if (act.discountType === 'percentage') {
            const pct = Math.min(Number(act.value ?? 0), 100);
            totalGroupDiscount = groupValue * (pct / 100);
          } else {
            totalGroupDiscount = Math.min(Number(act.value ?? 0) * groupQty, groupValue);
          }
          console.debug(`${label} BULK: groupQty=${groupQty} ≥ minQty=${minQty} → ₺${totalGroupDiscount.toFixed(2)}`);
        } else {
          // BUY_X_GET_Y — free items are cheapest units
          const freeQty   = Number(act.freeQty ?? 1);
          const setCount  = Math.floor(groupQty / minQty);
          const totalFree = Math.min(setCount * freeQty, groupQty);
          // Sort units by price ascending to give free to cheapest
          const units = matching
            .flatMap(i => Array(i.quantity).fill(i.price) as number[])
            .sort((a, b) => a - b);
          totalGroupDiscount = units.slice(0, totalFree).reduce((s, p) => s + p, 0);
          console.debug(`${label} BUY_X_GET_Y: sets=${setCount} freeQty=${totalFree} → ₺${totalGroupDiscount.toFixed(2)}`);
        }

        if (totalGroupDiscount <= 0) continue;

        // Distribute proportionally by line value across matching items
        matching.forEach(item => {
          const lineVal = item.price * item.quantity;
          const share   = groupValue > 0 ? (lineVal / groupValue) * totalGroupDiscount : 0;
          const key     = itemKey(item);
          const existing = itemDiscountExtra.get(key) ?? 0;

          // Only apply if better than any existing group discount for this item
          if (share > existing) {
            itemDiscountExtra.set(key, share);
            // Also push as itemBest if better than per-item best
            const idx = items.findIndex(i => itemKey(i) === key);
            if (idx !== -1) {
              const cur = itemBest[idx];
              if (!cur || share > cur.discountAmt) {
                itemBest[idx] = {
                  ruleId:       rule.id,
                  campaignId:   campaign.id,
                  campaignName: campaign.name,
                  rule:         { type: rule.type, conditions: rule.conditions, actions: rule.actions },
                  discountAmt:  share,
                };
              }
            }
          }
        });
      }
    }

    // ── Step 2: Build itemBreakdown ────────────────────────────────────────
    const itemBreakdown: ItemBreakdown[] = items.map((item, idx) => {
      const best      = itemBest[idx];
      const disc      = best?.discountAmt ?? 0;
      const lineOrig  = item.price * item.quantity;
      const lineFinal = Math.max(0, lineOrig - disc);
      return {
        productId:      item.productId,
        variantId:      item.variantId ?? null,
        quantity:       item.quantity,
        originalPrice:  item.price,
        unitDiscount:   item.quantity > 0 ? disc / item.quantity : 0,
        finalUnitPrice: item.quantity > 0 ? lineFinal / item.quantity : item.price,
        lineTotal:      lineFinal,
        appliedRule:    best ? `${best.campaignName} — ${ruleDescription(best.rule)}` : null,
      };
    });

    const subtotalAfterItems = itemBreakdown.reduce((s, i) => s + i.lineTotal, 0);

    // ── Step 3: Aggregate item discount lines ──────────────────────────────
    const itemDiscountMap = new Map<string, DiscountLine>();
    itemBest.forEach((best, idx) => {
      if (!best) return;
      const key = `${best.campaignId}:${best.ruleId}`;
      if (!itemDiscountMap.has(key)) {
        itemDiscountMap.set(key, {
          campaignId:         best.campaignId,
          campaignName:       best.campaignName,
          ruleId:             best.ruleId,
          ruleType:           best.rule.type,
          description:        ruleDescription(best.rule),
          discountAmount:     0,
          affectedProductIds: [],
        });
      }
      const line = itemDiscountMap.get(key)!;
      line.discountAmount += best.discountAmt;
      if (!line.affectedProductIds.includes(items[idx].productId)) {
        line.affectedProductIds.push(items[idx].productId);
      }
    });

    // ── Step 4: Cart-level discounts ───────────────────────────────────────
    const cartDiscountLines: DiscountLine[] = [];
    let   cartExtraDiscount = 0;

    for (const campaign of campaigns) {
      for (const rule of campaign.campaignRules) {
        if (rule.type !== 'CART_DISCOUNT') continue;

        const discount = computeCartDiscount(
          { type: rule.type, conditions: rule.conditions, actions: rule.actions },
          subtotalAfterItems,
          totalQty,
        );
        if (!discount || discount <= 0) {
          console.debug(`[Campaign] [${campaign.name}/CART_DISCOUNT] skipped: discount=${discount ?? 0} subtotal=₺${subtotalAfterItems.toFixed(2)}`);
          continue;
        }

        const betterExists = cartDiscountLines.some(l => l.discountAmount >= discount);
        if (!betterExists) {
          cartDiscountLines.push({
            campaignId:         campaign.id,
            campaignName:       campaign.name,
            ruleId:             rule.id,
            ruleType:           rule.type,
            description:        ruleDescription({ type: rule.type, conditions: rule.conditions, actions: rule.actions }),
            discountAmount:     discount,
            affectedProductIds: items.map(i => i.productId),
          });
          cartExtraDiscount = Math.max(cartExtraDiscount, discount);
        }
      }
    }

    // Pick best single cart discount
    const bestCartLine = cartDiscountLines.sort((a, b) => b.discountAmount - a.discountAmount)[0];
    const allDiscounts = [
      ...Array.from(itemDiscountMap.values()),
      ...(bestCartLine ? [bestCartLine] : []),
    ];

    const totalSavings = allDiscounts.reduce((s, d) => s + d.discountAmount, 0);
    const finalPrice   = Math.max(0, originalTotal - totalSavings);

    return {
      originalTotal,
      finalPrice: Math.round(finalPrice * 100) / 100,
      savings:    Math.round(totalSavings * 100) / 100,
      discounts:  allDiscounts,
      itemBreakdown,
    };
  }

  // ── Legacy single-price calculator (backward compat) ──────────────────────

  async calculatePrice(originalPrice: number, tenantId: string): Promise<PriceCalcResult> {
    if (originalPrice <= 0) {
      return { originalPrice, discountedPrice: 0, discountAmount: 0, discountPct: 0, campaign: null };
    }

    const result = await this.applyToCart(
      [{ productId: '__price_check__', quantity: 1, price: originalPrice }],
      tenantId,
    );

    const discount = result.savings;
    return {
      originalPrice,
      discountedPrice: Math.max(0, originalPrice - discount),
      discountAmount:  discount,
      discountPct:     Math.round((discount / originalPrice) * 100),
      campaign:        result.discounts[0]
        ? { id: result.discounts[0].campaignId, name: result.discounts[0].campaignName }
        : null,
    };
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async getStats(tenantId: string) {
    const now = new Date();
    const [total, active, scheduled, expired] = await prisma.$transaction([
      prisma.campaign.count({ where: { tenantId } }),
      prisma.campaign.count({ where: { tenantId, isActive: true,  startDate: { lte: now }, endDate: { gte: now } } }),
      prisma.campaign.count({ where: { tenantId, isActive: true,  startDate: { gt:  now } } }),
      prisma.campaign.count({ where: { tenantId, endDate: { lt: now } } }),
    ]);
    return { total, active, scheduled, expired };
  }
}
