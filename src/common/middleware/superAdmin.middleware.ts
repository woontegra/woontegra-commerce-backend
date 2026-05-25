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

  const r = String(req.user.role || '').toUpperCase();
  if (r !== 'SUPER_ADMIN') {
    res.status(403).json({ success: false, error: 'Super admin access required' });
    return;
  }

  next();
};

/** Only SUPER_ADMIN (platform impersonation); OWNER / ADMIN excluded. */
export const requireStrictSuperAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  const r = String(req.user.role || '').toUpperCase();
  if (r !== 'SUPER_ADMIN') {
    res.status(403).json({ success: false, error: 'Only SUPER_ADMIN may use this action.' });
    return;
  }
  next();
};

export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'OWNER', 'admin', 'superadmin', 'owner'];
  if (!allowedRoles.includes(req.user.role)) {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return;
  }

  next();
};

export default requireSuperAdmin;
