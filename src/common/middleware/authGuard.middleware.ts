import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './error.middleware';

interface AuthGuardOptions {
  roles?: string[];
  permissions?: string[];
  requireAuth?: boolean;
  requireActiveUser?: boolean;
  checkSubscription?: boolean | string[];
  checkPlan?: string[];
}

export class AuthGuard {
  static requireAuth = (options: AuthGuardOptions = {}) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const { requireAuth = true, roles = [], permissions = [], requireActiveUser = false, checkSubscription = false, checkPlan = [] } = options;
      
      // Check if authentication is required
      if (requireAuth) {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          throw new AppError('Authentication required', 401);
        }
        
        let decoded: any;
        try {
          decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
          (req as any).user = decoded;
        } catch (error) {
          throw new AppError('Invalid token', 401);
        }
        
        // Check if user is active
        if (requireActiveUser && !decoded.isActive) {
          throw new AppError('Account is not active', 403);
        }
      }

      // Check user roles
      if (roles.length > 0) {
        const user = (req as any).user;
        if (!user || !roles.includes(user.role)) {
          throw new AppError('Insufficient permissions', 403);
        }
      }

      // Check permissions
      if (permissions.length > 0) {
        const user = ( req as any).user;
        const userPermissions = user.permissions || [];
        const hasPermission = permissions.every(permission => userPermissions.includes(permission));
        
        if (!hasPermission) {
          throw new AppError('Insufficient permissions', 403);
        }
      }

      // Check subscription plan
      if (checkPlan.length > 0) {
        const user = (req as any).user;
        if (!user || !checkPlan.includes(user.plan)) {
          throw new AppError('This feature requires a higher plan', 403);
        }
      }

      next();
    };
  };

  static requireRole = (role: string) => {
    return this.requireAuth({ roles: [role] });
  };

  static requirePermission = (permission: string) => {
    return this.requireAuth({ permissions: [permission] });
  };

  static requireAnyRole = (roles: string[]) => {
    return this.requireAuth({ roles });
  };

  static requireAnyPermission = (permissions: string[]) => {
    return this.requireAuth({ permissions });
  };

  static requireSubscription = (plans: string[]) => {
    return this.requireAuth({ checkSubscription: plans });
  };

  static requireActiveUser = () => {
    return this.requireAuth({ requireActiveUser: true });
  };

  static requireAdmin = () => {
    return this.requireAuth({ roles: ['ADMIN'] });
  };

  static requireManager = () => {
    return this.requireAuth({ roles: ['ADMIN', 'MANAGER'] });
  };

  static requirePlanOrAbove = (plan: string) => {
    const plans = [plan, 'PRO', 'ADVANCED'];
    return this.requireAuth({ checkSubscription: plans });
  };

  static requireProOrAbove = () => {
    return this.requireAuth({ checkSubscription: ['PRO', 'ADVANCED'] });
  };

  static requireAdvanced = () => {
    return this.requireAuth({ checkSubscription: ['ADVANCED'] });
  };
}

// Convenience functions
export const requireAuth = AuthGuard.requireAuth;
export const requireRole = AuthGuard.requireRole;
export const requirePermission = AuthGuard.requirePermission;
export const requireAnyRole = AuthGuard.requireAnyRole;
export const requireAnyPermission = AuthGuard.requireAnyPermission;
export const requireSubscription = AuthGuard.requireSubscription;
export const requireActiveUser = AuthGuard.requireActiveUser;
export const requireAdmin = AuthGuard.requireAdmin;
export const requireManager = AuthGuard.requireManager;
export const requirePlanOrAbove = AuthGuard.requirePlanOrAbove;
export const requireProOrAbove = AuthGuard.requireProOrAbove;
export const requireAdvanced = AuthGuard.requireAdvanced;

export default AuthGuard;
