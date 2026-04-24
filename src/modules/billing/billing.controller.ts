import { Request, Response } from 'express';
import { BillingCycle, Plan } from '@prisma/client';
import { BillingService, PLAN_PRICES_TRY } from './billing.service';
import { InvoiceService } from './invoice.service';
import { logger } from '../../config/logger';

const billingService = new BillingService();
const invoiceService = new InvoiceService();

interface AuthRequest extends Request {
  user?: { userId: string; tenantId: string; role: string; email: string };
}

// ── POST /api/billing/payment/init ───────────────────────────────────────────
export async function initPayment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId, tenantId } = req.user!;
    const { plan, billingCycle = 'MONTHLY' } = req.body;

    if (!plan || !Object.values(Plan).includes(plan)) {
      res.status(400).json({ success: false, message: 'Geçersiz plan.' });
      return;
    }

    if (!Object.values(BillingCycle).includes(billingCycle)) {
      res.status(400).json({ success: false, message: 'Geçersiz fatura döngüsü.' });
      return;
    }

    if (plan === Plan.STARTER) {
      res.status(400).json({ success: false, message: 'STARTER plan ücretsizdir, ödeme gerekmez.' });
      return;
    }

    const buyerIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || '127.0.0.1';

    const result = await billingService.initPayment(userId, tenantId, plan as Plan, billingCycle as BillingCycle, buyerIp);

    res.json({
      success: true,
      data:    result,
    });
  } catch (err: any) {
    logger.error({ message: 'initPayment error', error: err?.message });
    res.status(500).json({ success: false, message: err?.message || 'Ödeme başlatılamadı.' });
  }
}

// ── POST /api/billing/payment/callback ──────────────────────────────────────
// Called by iyzico after payment — must redirect browser to frontend
export async function paymentCallback(req: Request, res: Response): Promise<void> {
  try {
    const token = req.body?.token || req.query?.token;

    logger.info({ message: 'iyzico callback received', token });

    const { redirectUrl } = await billingService.handleCallback(token);

    // Redirect browser to frontend result page
    res.redirect(302, redirectUrl);
  } catch (err: any) {
    logger.error({ message: 'paymentCallback error', error: err?.message });
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(302, `${frontendUrl}/payment-result?status=failed&reason=server_error`);
  }
}

// ── POST /api/billing/payment/webhook ───────────────────────────────────────
export async function paymentWebhook(req: Request, res: Response): Promise<void> {
  try {
    const signature = req.headers['x-iyz-signature'] as string | undefined;
    // rawBody is available because of the express.raw() middleware on this route
    const rawBody   = (req as any).rawBody || JSON.stringify(req.body);

    await billingService.handleWebhook(rawBody, signature);

    res.status(200).json({ received: true });
  } catch (err: any) {
    logger.error({ message: 'paymentWebhook error', error: err?.message });
    res.status(400).json({ success: false, message: err?.message });
  }
}

// ── GET /api/billing/subscription ───────────────────────────────────────────
export async function getSubscription(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { tenantId } = req.user!;
    const subscription = await billingService.getCurrentSubscription(tenantId);

    res.json({
      success: true,
      data:    subscription,
    });
  } catch (err: any) {
    logger.error({ message: 'getSubscription error', error: err?.message });
    res.status(500).json({ success: false, message: 'Abonelik bilgisi alınamadı.' });
  }
}

// ── POST /api/billing/subscription/cancel ───────────────────────────────────
export async function cancelSubscription(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { tenantId, id: userId } = req.user!;
    await billingService.cancelSubscription(tenantId, userId);

    res.json({ success: true, message: 'Abonelik iptal edildi. Dönem sonuna kadar erişiminiz devam edecek.' });
  } catch (err: any) {
    logger.error({ message: 'cancelSubscription error', error: err?.message });
    res.status(400).json({ success: false, message: err?.message || 'Abonelik iptal edilemedi.' });
  }
}

// ── GET /api/billing/history ─────────────────────────────────────────────────
export async function getBillingHistory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { tenantId } = req.user!;
    const history = await billingService.getBillingHistory(tenantId);

    res.json({ success: true, data: history });
  } catch (err: any) {
    logger.error({ message: 'getBillingHistory error', error: err?.message });
    res.status(500).json({ success: false, message: 'Fatura geçmişi alınamadı.' });
  }
}

// ── POST /api/billing/subscription/upgrade ───────────────────────────────────
export async function upgradeSubscription(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId, tenantId } = req.user!;
    const { plan, billingCycle = 'MONTHLY' } = req.body;

    if (!plan || !Object.values(Plan).includes(plan)) {
      res.status(400).json({ success: false, message: 'Geçersiz plan.' }); return;
    }

    const result = await invoiceService.processUpgrade(
      tenantId, userId, plan as Plan, billingCycle as BillingCycle,
    );

    // If net charge > 0, trigger iyzico checkout for the pro-rated amount
    if (result.proration.netAmount > 0) {
      const buyerIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || '127.0.0.1';
      const checkout = await billingService.initPayment(
        userId, tenantId, plan as Plan, billingCycle as BillingCycle, buyerIp,
      );
      res.json({
        success:   true,
        type:      'payment_required',
        proration: result.proration,
        invoiceId: result.invoiceId,
        checkout,
      });
    } else {
      // Free upgrade (e.g. same price or credit exceeds charge)
      res.json({
        success:   true,
        type:      'immediate',
        proration: result.proration,
        invoiceId: result.invoiceId,
        message:   `Plan ${plan} olarak güncellendi.`,
      });
    }
  } catch (err: any) {
    logger.error({ message: 'upgradeSubscription error', error: err?.message });
    res.status(400).json({ success: false, message: err?.message || 'Yükseltme yapılamadı.' });
  }
}

// ── POST /api/billing/subscription/downgrade ─────────────────────────────────
export async function downgradeSubscription(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { tenantId } = req.user!;
    const { plan, billingCycle = 'MONTHLY' } = req.body;

    if (!plan || !Object.values(Plan).includes(plan)) {
      res.status(400).json({ success: false, message: 'Geçersiz plan.' }); return;
    }

    const result = await invoiceService.processDowngrade(
      tenantId, plan as Plan, billingCycle as BillingCycle,
    );

    res.json({
      success:       true,
      message:       `Plan düşürme planlandı. ${result.effectiveDate.toLocaleDateString('tr-TR')} tarihinden itibaren ${plan} planına geçilecek.`,
      effectiveDate: result.effectiveDate,
      invoiceId:     result.invoiceId,
    });
  } catch (err: any) {
    logger.error({ message: 'downgradeSubscription error', error: err?.message });
    res.status(400).json({ success: false, message: err?.message || 'Plan düşürme yapılamadı.' });
  }
}

// ── GET /api/billing/invoices ────────────────────────────────────────────────
export async function getInvoices(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { tenantId } = req.user!;
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

    const result = await invoiceService.getTenantInvoices(tenantId, page, limit);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message });
  }
}

// ── GET /api/billing/invoices/:id ────────────────────────────────────────────
export async function getInvoiceById(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { tenantId } = req.user!;
    const invoice = await invoiceService.getInvoice(req.params.id, tenantId);

    if (!invoice) {
      res.status(404).json({ success: false, message: 'Fatura bulunamadı.' }); return;
    }
    res.json({ success: true, data: invoice });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message });
  }
}

// ── GET /api/billing/plans ───────────────────────────────────────────────────
export async function getPlans(_req: Request, res: Response): Promise<void> {
  const plans = [
    {
      key:     'STARTER',
      name:    'Starter',
      prices:  PLAN_PRICES_TRY.STARTER,
      currency: 'TRY',
      features: [
        '50 Ürün',
        'Temel varyant desteği (3 varyant)',
        'Standart raporlar',
        'E-posta desteği',
        'Mobil uyumlu panel',
      ],
      limits: { products: 50, variants: 3, pageBuilder: false, blog: false, analytics: false, customDomain: false },
    },
    {
      key:     'PRO',
      name:    'Pro',
      prices:  PLAN_PRICES_TRY.PRO,
      currency: 'TRY',
      popular: true,
      features: [
        '500 Ürün',
        'Gelişmiş varyant desteği (10 varyant)',
        'Sayfa düzenleyici',
        'Blog yönetimi',
        'Gelişmiş analitik',
        'API erişimi',
        'Öncelikli e-posta desteği',
      ],
      limits: { products: 500, variants: 10, pageBuilder: true, blog: true, analytics: true, customDomain: false },
    },
    {
      key:     'ENTERPRISE',
      name:    'Enterprise',
      prices:  PLAN_PRICES_TRY.ENTERPRISE,
      currency: 'TRY',
      features: [
        'Sınırsız ürün',
        'Sınırsız varyant',
        'Özel domain desteği',
        'Gelişmiş analitik & raporlar',
        'White-label panel',
        'API tam erişim',
        'Öncelikli destek',
        'SLA garantisi',
      ],
      limits: { products: -1, variants: -1, pageBuilder: true, blog: true, analytics: true, customDomain: true },
    },
  ];

  res.json({ success: true, data: plans });
}
