import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { resolvePermissions } from './permission.service';

/**
 * requirePermission('product.create')
 *
 * Usage in routes:
 *   router.post('/products', authenticate, requirePermission('product.create'), handler)
 *
 * Accepts multiple keys (ANY match grants access):
 *   requirePermission('order.view', 'order.manage')
 */
export function requirePermission(...keys: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;

    if (!user) {
      res.status(401).json({ success: false, message: 'Kimlik doğrulaması gerekli.' });
      return;
    }

    // SUPER_ADMIN bypasses all permission checks
    if (user.role === 'SUPER_ADMIN') { next(); return; }

    try {
      const effective = await resolvePermissions(user.id ?? (user as any).userId, user.role);
      const allowed   = keys.some((k) => effective.has(k));

      if (!allowed) {
        res.status(403).json({
          success:  false,
          message:  'Bu işlem için yetkiniz yok.',
          required: keys,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * attachPermissions — injects req.perms into every authenticated request.
 * Use ONCE after authenticate middleware (globally or per-router).
 * Allows controllers to call req.can('product.create') without extra middleware.
 */
export function attachPermissions() {
  return async (req: AuthRequest & { can?: (key: string) => boolean; perms?: Set<string> },
                _res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) { next(); return; }

    try {
      const perms = await resolvePermissions(user.id ?? (user as any).userId, user.role);
      req.perms   = perms;
      req.can     = (key: string) => user.role === 'SUPER_ADMIN' || perms.has(key);
      next();
    } catch {
      next();
    }
  };
}
