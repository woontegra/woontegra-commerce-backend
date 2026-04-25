import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../../common/middleware/error.middleware';
import { generateToken } from '../../common/utils/jwt.util';

const prisma = new PrismaClient();

export class PlanController {
  async getPlans(req: Request, res: Response): Promise<void> {
    try {
      const plans = await prisma.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' }
      });

      res.json({
        status: 'success',
        data: plans.map(plan => ({
          id: plan.id,
          name: plan.name,
          slug: plan.slug,
          price: plan.price,
          currency: plan.currency,
          interval: plan.interval,
          features: plan.features,
          limits: plan.limits,
          isActive: plan.isActive,
          sortOrder: plan.sortOrder
        }))
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get plans' });
    }
  }

  async getPlanBySlug(req: Request, res: Response): Promise<void> {
    try {
      const { slug } = req.params;
      
      const plan = await prisma.subscriptionPlan.findUnique({
        where: { 
          slug,
          isActive: true 
        }
      });

      if (!plan) {
        throw new AppError('Plan not found', 404);
      }

      res.json({
        status: 'success',
        data: plan
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get plan' });
    }
  }

  async createSubscription(req: Request, res: Response): Promise<void> {
    try {
      const { planId } = req.body;
      const { tenantId } = (req as any).user.tenantId;
      const { userId } = (req as any).user.id;

      // Get plan details
      const plan = await prisma.subscriptionPlan.findUnique({
        where: { id: planId, isActive: true }
      });

      if (!plan) {
        throw new AppError('Plan not found', 404);
      }

      // Check if user already has active subscription
      const existingSubscription = await prisma.subscription.findFirst({
        where: {
          userId,
          status: 'active',
          currentPeriodEnd: { gte: new Date() }
        }
      });

      if (existingSubscription) {
        throw new Error('User already has an active subscription');
      }

      // Create subscription
      const subscription = await prisma.subscription.create({
        data: {
          userId,
          tenantId,
          planId,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: plan.interval === 'yearly' 
            ? new Date(new Date().setFullYear(new Date().getFullYear() + 1, 0, 1))
            : new Date(new Date().setMonth(new Date().getMonth() + 1, 0)),
          createdAt: new Date()
        }
      });

      res.status(201).json({
        status: 'success',
        data: {
          subscription,
          plan
        }
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to create subscription' });
      }
    }
  }

  async getUserSubscription(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId } = (req as any).user.tenantId;
      const { userId } = (req as any).user.id;

      const subscription = await prisma.subscription.findFirst({
        where: {
          userId,
          tenantId,
          status: 'active',
          currentPeriodEnd: { gte: new Date() }
        },
        include: {
          plan: true
        }
      });

      if (!subscription) {
        res.status(404).json({ error: 'No active subscription found' });
        return;
      }

      res.json({
        status: 'success',
        data: {
          subscription,
          plan: subscription.plan,
          features: subscription.plan.features
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get subscription' });
    }
  }

  async cancelSubscription(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId } = (req as any).user.tenantId;
      const { userId } = (req as any).user.id;

      const subscription = await prisma.subscription.findFirst({
        where: {
          userId,
          tenantId,
          status: 'active'
        }
      });

      if (!subscription) {
        throw new AppError('No active subscription found', 404);
      }

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date()
        }
      });

      res.json({
        status: 'success',
        data: { message: 'Subscription cancelled' }
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode). json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to cancel subscription' });
      }
    }
  }

  async changePlan(req: Request, res: Response): Promise<void> {
    try {
      const { planId } = req.body;
      const { tenantId } = (req as any).user.tenantId;
      const { userId } = (req as any).user.id;

      // Get current subscription
      const currentSubscription = await prisma.subscription.findFirst({
        where: {
          userId,
          tenantId,
          status: 'active'
        }
      });

      if (!currentSubscription) {
        throw new AppError('No active subscription found', 404);
      }

      // Get new plan details
      const newPlan = await prisma.subscriptionPlan.findUnique({
        where: { id: planId, isActive: true }
      });

      if (!newPlan) {
        throw new AppError('Plan not found', 404);
      }

      // Cancel current subscription
      await prisma.subscription.update({
        where: { id: currentSubscription.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date()
        }
      });

      // Create new subscription
      const newSubscription = await prisma.subscription.create({
        data: {
          userId,
          tenantId,
          planId,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: newPlan.interval === 'yearly' 
            ? new Date(new Date().setFullYear(new Date().getFullYear() + 1, 0, 1))
            : new Date(new Date().setMonth(new Date().getMonth() + 1, 0)),
          createdAt: new Date()
        }
      });

      res.json({
        status: 'success',
        data: {
          subscription: newSubscription,
          plan: newPlan
        }
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to change plan' });
      }
    }
  }
}
