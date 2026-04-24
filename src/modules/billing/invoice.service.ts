import { PrismaClient, Plan, BillingCycle, InvoiceStatus, InvoiceType, SubscriptionStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { logger } from '../../config/logger';
import { PLAN_PRICES_TRY } from './billing.service';

const prisma = new PrismaClient();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LineItem {
  description: string;
  quantity:    number;
  unitAmount:  number;   // in TRY cents (kuruş)
  amount:      number;
}

export interface ProrationResult {
  creditAmount:   number;  // unused days value of old plan
  chargeAmount:   number;  // new plan daily rate × remaining days
  netAmount:      number;  // charge - credit (what we charge)
  daysRemaining:  number;
  totalDays:      number;
  oldPlanCredit:  LineItem;
  newPlanCharge:  LineItem;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
}

function daysInCycle(billingCycle: BillingCycle): number {
  return billingCycle === BillingCycle.MONTHLY ? 30 : 365;
}

/** Generate sequential invoice number: INV-YYYYMM-NNNN */
async function generateInvoiceNumber(): Promise<string> {
  const prefix = `INV-${new Date().toISOString().slice(0, 7).replace('-', '')}`;
  const count  = await prisma.invoice.count({
    where: { number: { startsWith: prefix } },
  });
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

// ─── InvoiceService ───────────────────────────────────────────────────────────

export class InvoiceService {

  /**
   * Calculate proration when upgrading mid-cycle.
   *
   * Returns how much to charge NOW for the remaining period
   * after crediting the unused portion of the old plan.
   */
  calculateProration(
    oldPlan:       Plan,
    newPlan:       Plan,
    billingCycle:  BillingCycle,
    subscriptionStart: Date,
    subscriptionEnd:   Date,
  ): ProrationResult {
    const now           = new Date();
    const totalDays     = daysInCycle(billingCycle);
    const daysRemaining = daysBetween(now, subscriptionEnd);

    const oldPrice = PLAN_PRICES_TRY[oldPlan]?.[billingCycle] ?? 0;
    const newPrice = PLAN_PRICES_TRY[newPlan]?.[billingCycle] ?? 0;

    const dailyOld = oldPrice / totalDays;
    const dailyNew = newPrice / totalDays;

    const creditAmount = Math.round(dailyOld * daysRemaining * 100) / 100;  // unused old plan value
    const chargeAmount = Math.round(dailyNew * daysRemaining * 100) / 100;  // new plan cost for remainder
    const netAmount    = Math.max(0, Math.round((chargeAmount - creditAmount) * 100) / 100);

    logger.info({
      message: 'Proration calculated',
      oldPlan, newPlan, billingCycle,
      daysRemaining, totalDays,
      creditAmount, chargeAmount, netAmount,
    });

    return {
      creditAmount,
      chargeAmount,
      netAmount,
      daysRemaining,
      totalDays,
      oldPlanCredit: {
        description: `${oldPlan} planı iade (${daysRemaining} gün × ₺${dailyOld.toFixed(2)}/gün)`,
        quantity:    daysRemaining,
        unitAmount:  -dailyOld,
        amount:      -creditAmount,
      },
      newPlanCharge: {
        description: `${newPlan} planı kalan dönem (${daysRemaining} gün × ₺${dailyNew.toFixed(2)}/gün)`,
        quantity:    daysRemaining,
        unitAmount:  dailyNew,
        amount:      chargeAmount,
      },
    };
  }

  /**
   * Create an invoice record in the database.
   */
  async createInvoice(data: {
    tenantId:       string;
    subscriptionId?: string;
    paymentId?:     string;
    type:           InvoiceType;
    status?:        InvoiceStatus;
    currency?:      string;
    subtotal:       number;
    tax?:           number;
    total:          number;
    description?:   string;
    lineItems:      LineItem[];
    dueDate?:       Date;
    periodStart?:   Date;
    periodEnd?:     Date;
    metadata?:      Record<string, unknown>;
  }) {
    const number  = await generateInvoiceNumber();
    const tax     = data.tax ?? 0;

    const invoice = await prisma.invoice.create({
      data: {
        tenantId:       data.tenantId,
        subscriptionId: data.subscriptionId,
        paymentId:      data.paymentId,
        type:           data.type,
        status:         data.status ?? InvoiceStatus.OPEN,
        number,
        currency:       data.currency ?? 'TRY',
        subtotal:       new Decimal(data.subtotal),
        tax:            new Decimal(tax),
        total:          new Decimal(data.total),
        description:    data.description,
        lineItems:      data.lineItems,
        dueDate:        data.dueDate,
        periodStart:    data.periodStart,
        periodEnd:      data.periodEnd,
        metadata:       data.metadata,
      },
    });

    logger.info({ message: 'Invoice created', invoiceId: invoice.id, number, total: data.total });
    return invoice;
  }

  /**
   * Mark invoice as PAID (called after successful payment).
   */
  async markPaid(invoiceId: string, paymentId?: string) {
    return prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status:    InvoiceStatus.PAID,
        paidAt:    new Date(),
        ...(paymentId ? { paymentId } : {}),
      },
    });
  }

  /**
   * Void an invoice (e.g. on downgrade credit reversal).
   */
  async voidInvoice(invoiceId: string) {
    return prisma.invoice.update({
      where: { id: invoiceId },
      data:  { status: InvoiceStatus.VOID, voidedAt: new Date() },
    });
  }

  /**
   * Get all invoices for a tenant (paginated).
   */
  async getTenantInvoices(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [invoices, total] = await prisma.$transaction([
      prisma.invoice.findMany({
        where:   { tenantId },
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
      }),
      prisma.invoice.count({ where: { tenantId } }),
    ]);
    return { invoices, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Get a single invoice (with access check).
   */
  async getInvoice(invoiceId: string, tenantId: string) {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.tenantId !== tenantId) return null;
    return invoice;
  }

  // ── Plan change helpers ───────────────────────────────────────────────────

  /**
   * Handle UPGRADE: immediate plan switch + pro-rate charge invoice.
   *
   * Steps:
   *  1. Calculate proration
   *  2. Cancel current subscription (end now)
   *  3. Create new subscription from today
   *  4. Emit UPGRADE_PRORATION invoice (OPEN — awaits iyzico payment)
   *  5. Return proration data so controller can trigger iyzico checkout
   */
  async processUpgrade(
    tenantId:    string,
    userId:      string,
    newPlan:     Plan,
    billingCycle: BillingCycle,
  ): Promise<{ proration: ProrationResult; invoiceId: string; newSubscriptionId: string }> {

    const now = new Date();

    // Find active subscription
    const current = await prisma.subscription.findFirst({
      where: {
        tenantId,
        status: SubscriptionStatus.ACTIVE,
        endDate: { gte: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!current) throw new Error('Aktif abonelik bulunamadı.');

    const proration = this.calculateProration(
      current.plan,
      newPlan,
      billingCycle,
      current.startDate,
      current.endDate,
    );

    // Immediately cancel old subscription
    await prisma.subscription.update({
      where: { id: current.id },
      data:  { status: SubscriptionStatus.CANCELED, canceledAt: now, endDate: now },
    });

    // Create new subscription starting now
    const cycleEnd = new Date(now);
    if (billingCycle === BillingCycle.MONTHLY) {
      cycleEnd.setMonth(cycleEnd.getMonth() + 1);
    } else {
      cycleEnd.setFullYear(cycleEnd.getFullYear() + 1);
    }

    const newSub = await prisma.subscription.create({
      data: {
        tenantId,
        userId,
        plan:        newPlan,
        billingCycle,
        status:      SubscriptionStatus.PENDING, // activates on payment
        startDate:   now,
        endDate:     cycleEnd,
      },
    });

    // Create pro-rate invoice
    const invoice = await this.createInvoice({
      tenantId,
      subscriptionId: newSub.id,
      type:           InvoiceType.UPGRADE_PRORATION,
      status:         InvoiceStatus.OPEN,
      subtotal:       proration.netAmount,
      total:          proration.netAmount,
      description:    `Plan yükseltme: ${current.plan} → ${newPlan}`,
      lineItems:      [proration.oldPlanCredit, proration.newPlanCharge],
      periodStart:    now,
      periodEnd:      cycleEnd,
      metadata:       { oldPlan: current.plan, newPlan, billingCycle },
    });

    logger.info({
      message:        'Upgrade processed',
      tenantId,
      oldPlan:        current.plan,
      newPlan,
      prorationCharge: proration.netAmount,
      invoiceId:      invoice.id,
    });

    return { proration, invoiceId: invoice.id, newSubscriptionId: newSub.id };
  }

  /**
   * Handle DOWNGRADE: schedule plan change at period end.
   *
   * No charge now — sets pendingPlan on the subscription via metadata.
   * The lifecycle cron handles the actual switch when endDate arrives.
   */
  async processDowngrade(
    tenantId:    string,
    newPlan:     Plan,
    billingCycle: BillingCycle,
  ): Promise<{ effectiveDate: Date; invoiceId: string }> {

    const now = new Date();

    const current = await prisma.subscription.findFirst({
      where: {
        tenantId,
        status:  SubscriptionStatus.ACTIVE,
        endDate: { gte: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!current) throw new Error('Aktif abonelik bulunamadı.');

    // Store the pending downgrade in metadata
    await prisma.subscription.update({
      where: { id: current.id },
      data:  {
        metadata: {
          ...(current.metadata as object ?? {}),
          pendingDowngrade: {
            plan:        newPlan,
            billingCycle,
            scheduledAt: now.toISOString(),
          },
        },
      },
    });

    // Emit a DRAFT credit note (becomes effective at period end)
    const invoice = await this.createInvoice({
      tenantId,
      subscriptionId: current.id,
      type:           InvoiceType.DOWNGRADE_CREDIT,
      status:         InvoiceStatus.DRAFT,  // not yet charged
      subtotal:       0,
      total:          0,
      description:    `Plan düşürme planlandı: ${current.plan} → ${newPlan} (${current.endDate.toLocaleDateString('tr-TR')} tarihinden itibaren)`,
      lineItems:      [],
      periodStart:    current.endDate,
      metadata:       { currentPlan: current.plan, newPlan, billingCycle },
    });

    logger.info({
      message:       'Downgrade scheduled',
      tenantId,
      currentPlan:   current.plan,
      newPlan,
      effectiveDate: current.endDate,
      invoiceId:     invoice.id,
    });

    return { effectiveDate: current.endDate, invoiceId: invoice.id };
  }

  /**
   * Called by billing callback: mark invoice PAID after iyzico confirms.
   */
  async markInvoicePaidBySubscription(subscriptionId: string, paymentId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: {
        subscriptionId,
        status: InvoiceStatus.OPEN,
        type:   { in: [InvoiceType.SUBSCRIPTION, InvoiceType.UPGRADE_PRORATION] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (invoice) {
      await this.markPaid(invoice.id, paymentId);
    }
  }

  /**
   * Create a standard subscription invoice (called when payment is initiated).
   */
  async createSubscriptionInvoice(
    tenantId:       string,
    subscriptionId: string,
    plan:           Plan,
    billingCycle:   BillingCycle,
    amount:         number,
    periodStart:    Date,
    periodEnd:      Date,
  ) {
    const cycleName = billingCycle === BillingCycle.MONTHLY ? 'aylık' : 'yıllık';

    return this.createInvoice({
      tenantId,
      subscriptionId,
      type:        InvoiceType.SUBSCRIPTION,
      status:      InvoiceStatus.OPEN,
      subtotal:    amount,
      total:       amount,
      description: `${plan} planı — ${cycleName} abonelik`,
      lineItems:   [{
        description: `${plan} ${cycleName} abonelik`,
        quantity:    1,
        unitAmount:  amount,
        amount,
      }],
      periodStart,
      periodEnd,
    });
  }
}
