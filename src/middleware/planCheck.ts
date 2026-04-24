import { Request, Response, NextFunction } from 'express';
import { Plan, canAccessFeature, isWithinLimit, getPlanLimits } from '../config/plans';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    plan: Plan;
    tenantId: string;
  };
}

export function requirePlanFeature(feature: keyof ReturnType<typeof getPlanLimits>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const userPlan = req.user?.plan || Plan.STARTER;

    if (!canAccessFeature(userPlan, feature)) {
      return res.status(403).json({
        success: false,
        error: 'Plan upgrade required',
        message: `This feature requires a higher plan. Current plan: ${userPlan}`,
        requiredFeature: feature,
      });
    }

    next();
  };
}

export async function checkProductLimit(req: AuthRequest, res: Response, next: NextFunction) {
  const userPlan = req.user?.plan || Plan.STARTER;
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const productCount = await prisma.product.count({
      where: { tenantId },
    });

    if (!isWithinLimit(userPlan, 'maxProducts', productCount)) {
      const limits = getPlanLimits(userPlan);
      return res.status(403).json({
        success: false,
        error: 'Product limit reached',
        message: `Your ${userPlan} plan allows up to ${limits.maxProducts} products. Please upgrade to add more.`,
        currentCount: productCount,
        limit: limits.maxProducts,
      });
    }

    await prisma.$disconnect();
    next();
  } catch (error) {
    console.error('Plan check error:', error);
    next();
  }
}

export async function checkVariantLimit(req: AuthRequest, res: Response, next: NextFunction) {
  const userPlan = req.user?.plan || Plan.STARTER;
  const productId = req.params.productId || req.body.productId;

  if (!productId) {
    return next();
  }

  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const variantCount = await prisma.productVariant.count({
      where: { productId },
    });

    if (!isWithinLimit(userPlan, 'maxVariantsPerProduct', variantCount)) {
      const limits = getPlanLimits(userPlan);
      return res.status(403).json({
        success: false,
        error: 'Variant limit reached',
        message: `Your ${userPlan} plan allows up to ${limits.maxVariantsPerProduct} variants per product. Please upgrade to add more.`,
        currentCount: variantCount,
        limit: limits.maxVariantsPerProduct,
      });
    }

    await prisma.$disconnect();
    next();
  } catch (error) {
    console.error('Variant limit check error:', error);
    next();
  }
}
