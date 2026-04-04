import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import prisma from '../../config/database';

export const tenantMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user?.tenantId) {
      res.status(403).json({ error: 'Tenant information missing' });
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.user.tenantId },
    });

    if (!tenant || !tenant.isActive) {
      res.status(403).json({ error: 'Tenant not found or inactive' });
      return;
    }

    next();
  } catch (error) {
    res.status(500).json({ error: 'Tenant validation failed' });
  }
};
