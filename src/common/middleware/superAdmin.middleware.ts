import { Request, Response, NextFunction } from 'express';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    tenantId?: string;
    role: string;
    email: string;
  };
}

export const requireSuperAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'superadmin') {
    res.status(403).json({ success: false, error: 'Super admin access required' });
    return;
  }

  next();
};

export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'admin', 'superadmin'];
  if (!allowedRoles.includes(req.user.role)) {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return;
  }

  next();
};

export default requireSuperAdmin;
