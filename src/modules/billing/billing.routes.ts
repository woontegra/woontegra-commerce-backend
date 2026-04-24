import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import { authenticate } from '../../common/middleware/authEnhanced';
import {
  initPayment,
  paymentCallback,
  paymentWebhook,
  getSubscription,
  cancelSubscription,
  getBillingHistory,
  getPlans,
  upgradeSubscription,
  downgradeSubscription,
  getInvoices,
  getInvoiceById,
} from './billing.controller';

const router = Router();

// ── Public: plan listing ─────────────────────────────────────────────────────
router.get('/plans', getPlans);

// ── Public: iyzico callback (browser redirect after payment) ────────────────
// Must be raw text so we can verify the HMAC signature
router.post(
  '/payment/callback',
  express.urlencoded({ extended: true }),
  paymentCallback,
);

// ── Public: iyzico webhook (async server-to-server events) ──────────────────
router.post(
  '/payment/webhook',
  express.raw({ type: '*/*' }),
  (req: Request, _res: Response, next: NextFunction) => {
    // Expose raw body for signature verification
    if (Buffer.isBuffer(req.body)) {
      (req as any).rawBody = req.body.toString('utf8');
    }
    next();
  },
  paymentWebhook,
);

// ── Protected: payment init & subscription management ───────────────────────
router.use(authenticate);

router.post('/payment/init',          initPayment);
router.get('/subscription',           getSubscription);
router.post('/subscription/cancel',   cancelSubscription);
router.post('/subscription/upgrade',  upgradeSubscription);
router.post('/subscription/downgrade',downgradeSubscription);
router.get('/history',                getBillingHistory);
router.get('/invoices',               getInvoices);
router.get('/invoices/:id',           getInvoiceById);

export default router;
