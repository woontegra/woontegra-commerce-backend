import { Request, Response } from 'express';
import { PaymentService } from './payment.service';
import { authenticateToken } from '../../common/middleware/auth.middleware';
import { PlanMiddleware } from '../../common/middleware/plan.middleware';

export const processPayment = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { planId, paymentMethodId, billingCycle, savePaymentMethod } = req.body;

    if (!planId || !paymentMethodId || !billingCycle) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (savePaymentMethod) {
      // Save payment method
      const result = await PaymentService.savePaymentMethod(user.id, req.body);
      return res.json(result);
    }

    // Process payment
    const result = await PaymentService.processPayment(user.id, {
      planId,
      paymentMethodId,
      billingCycle
    });

    res.json(result);
  } catch (error) {
    console.error('Payment processing error:', error);
    res.status(500).json({ error: 'Payment processing failed' });
  }
};

export const upgradePlan = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { planId, paymentMethodId, billingCycle } = req.body;

    if (!planId || !paymentMethodId || !billingCycle) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await PaymentService.upgradePlan(user.id, planId, {
      paymentMethodId,
      billingCycle
    });

    res.json(result);
  } catch (error) {
    console.error('Plan upgrade error:', error);
    res.status(500).json({ error: 'Plan upgrade failed' });
  }
};

export const getPaymentMethods = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await PaymentService.getUserPaymentMethods(user.id);
    res.json(result);
  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({ error: 'Failed to get payment methods' });
  }
};

export const deletePaymentMethod = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { paymentMethodId } = req.body;

    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!paymentMethodId) {
      return res.status(400).json({ error: 'Payment method ID is required' });
    }

    const result = await PaymentService.deletePaymentMethod(user.id, paymentMethodId);
    res.json(result);
  } catch (error) {
    console.error('Delete payment method error:', error);
    res.status(500).json({ error: 'Failed to delete payment method' });
  }
};

export const getBillingHistory = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await PaymentService.getBillingHistory(user.id);
    res.json(result);
  } catch (error) {
    console.error('Get billing history error:', error);
    res.status(500).json({ error: 'Failed to get billing history' });
  }
};

// Apply plan requirement for payment routes
export const requireProPlan = PlanMiddleware.requirePlan(['pro', 'advanced']);
export const requireAdvancedPlan = PlanMiddleware.requirePlan(['advanced']);
