import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    tenantId: string;
  };
}

/**
 * Role hierarchy (higher number = more permissions)
 */
const ROLE_HIERARCHY: Record<UserRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  STAFF: 2,
  USER: 1,
};

/**
 * Check if user has required role or higher
 */
export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Middleware to require specific role
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    const userRole = req.user.role;
    const hasPermission = allowedRoles.some(role => hasRole(userRole, role));

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden - Insufficient permissions',
        required: allowedRoles,
        current: userRole,
      });
    }

    next();
  };
}

/**
 * Middleware to require OWNER role
 */
export const requireOwner = requireRole(UserRole.OWNER);

/**
 * Middleware to require ADMIN or higher
 */
export const requireAdmin = requireRole(UserRole.ADMIN);

/**
 * Middleware to require STAFF or higher
 */
export const requireStaff = requireRole(UserRole.STAFF);

/**
 * Permission definitions by role
 */
export const PERMISSIONS = {
  // Product permissions
  'product.create': [UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF],
  'product.update': [UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF],
  'product.delete': [UserRole.OWNER, UserRole.ADMIN],
  'product.view': [UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF, UserRole.USER],

  // Order permissions
  'order.create': [UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF],
  'order.update': [UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF],
  'order.delete': [UserRole.OWNER, UserRole.ADMIN],
  'order.view': [UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF],

  // Customer permissions
  'customer.create': [UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF],
  'customer.update': [UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF],
  'customer.delete': [UserRole.OWNER, UserRole.ADMIN],
  'customer.view': [UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF],

  // Settings permissions
  'settings.update': [UserRole.OWNER, UserRole.ADMIN],
  'settings.view': [UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF],

  // User management
  'user.create': [UserRole.OWNER, UserRole.ADMIN],
  'user.update': [UserRole.OWNER, UserRole.ADMIN],
  'user.delete': [UserRole.OWNER],
  'user.view': [UserRole.OWNER, UserRole.ADMIN],

  // Reports
  'reports.view': [UserRole.OWNER, UserRole.ADMIN],
  'reports.export': [UserRole.OWNER, UserRole.ADMIN],

  // Billing
  'billing.view': [UserRole.OWNER],
  'billing.update': [UserRole.OWNER],
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Check if user has specific permission
 */
export function hasPermission(userRole: UserRole, permission: Permission): boolean {
  const allowedRoles = PERMISSIONS[permission];
  return allowedRoles.includes(userRole);
}

/**
 * Middleware to require specific permission
 */
export function requirePermission(permission: Permission) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden - Insufficient permissions',
        permission,
        role: req.user.role,
      });
    }

    next();
  };
}
