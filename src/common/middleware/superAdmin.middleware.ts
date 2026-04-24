import { Request, Response, NextFunction } from 'express';
import { authenticate } from './authEnhanced';
import { logger } from '../../config/logger';

interface AuthRequest extends Request {
  user?: { userId: string; tenantId: string; role: string; email: string };
}

/**
 * Middleware chain: authenticate → verify SUPER_ADMIN role.
 * Usage: router.use(requireSuperAdmin);  or  router.get('/path', ...requireSuperAdmin, handler)
 */
export const requireSuperAdmin = [
  authenticate,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== 'SUPER_ADMIN') {
      logger.warn({
        message: 'Super admin access denied',
        userId:  req.user?.userId,
        role:    req.user?.role,
        path:    req.path,
        ip:      req.ip,
      });
      return res.status(403).json({
        success: false,
        message: 'Bu alana erişim yetkiniz bulunmamaktadır.',
        code:    'SUPER_ADMIN_REQUIRED',
      });
    }
    next();
  },
];
