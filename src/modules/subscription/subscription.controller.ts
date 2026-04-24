import { Request, Response } from 'express';
import { PlanMiddleware } from '../../common/middleware/plan.middleware';
import prisma from '../../config/database';

export const getUsageStats = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const stats = await PlanMiddleware.getUsageStats(user.id);
    
    res.json({
      status: 'success',
      data: stats
    });
  } catch (error) {
    console.error('Usage stats error:', error);
    res.status(500).json({ error: 'Failed to get usage stats' });
  }
};

export const upgradePlan = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { planId } = req.body;

    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!planId) {
      return res.status(400).json({ error: 'Plan ID is required' });
    }

    // In real implementation, integrate with payment provider
    // For now, just update the user's plan
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { plan: planId }
    });

    res.json({
      status: 'success',
      message: 'Plan upgraded successfully',
      data: { plan: planId }
    });
  } catch (error) {
    console.error('Plan upgrade error:', error);
    res.status(500).json({ error: 'Failed to upgrade plan' });
  }
};

export const getCurrentPlan = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userWithSubscription = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        subscriptions: {
          include: {
            plan: true
          }
        }
      }
    });

    const currentPlan = userWithSubscription?.subscriptions[0]?.plan;
    
    res.json({
      status: 'success',
      data: currentPlan
    });
  } catch (error) {
    console.error('Get current plan error:', error);
    res.status(500).json({ error: 'Failed to get current plan' });
  }
};
