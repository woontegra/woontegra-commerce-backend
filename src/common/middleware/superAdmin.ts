import { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
    email: string;
  };
}

/**
 * SuperAdmin middleware — only SUPER_ADMIN (same policy as /api/admin).
 */
export function requireSuperAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const user = req.user;

    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const isSuperAdmin = String(user.role || '').toUpperCase() === 'SUPER_ADMIN';

    if (!isSuperAdmin) {
      logger.warn('[SuperAdmin] Unauthorized access attempt', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      res.status(403).json({ 
        error: 'Forbidden',
        message: 'Super admin access required',
      });
      return;
    }

    logger.info('[SuperAdmin] Access granted', {
      userId: user.id,
      email: user.email,
    });

    next();
  } catch (error) {
    logger.error('[SuperAdmin] Error in middleware', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
}
