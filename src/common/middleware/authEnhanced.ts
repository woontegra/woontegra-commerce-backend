import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { createUnauthorizedError, createForbiddenError, AppError } from './AppError';
import { logger } from '../../utils/logger';
import { traceContextFromAuth } from './requestId';
import { verifyToken as coreVerifyToken, type JwtPayload } from '../utils/jwt.util';

const prisma = new PrismaClient();

function resolveImpersonationAdminId(decoded: JwtPayload): string | undefined {
  if (decoded.isImpersonation === true && decoded.adminId) return decoded.adminId;
  if (decoded.impersonatedBy) return decoded.impersonatedBy;
  return undefined;
}

function isImpersonationToken(decoded: JwtPayload): boolean {
  if (decoded.isImpersonation === true && !!decoded.adminId) return true;
  return Boolean(decoded.impersonatedBy);
}

/** Only SUPER_ADMIN may issue / use impersonation tokens. */
async function isValidImpersonationIssuer(adminId: string | undefined): Promise<boolean> {
  if (!adminId) return true;
  const adminUser = await prisma.user.findUnique({
    where: { id: adminId },
    select: { role: true, isActive: true },
  });
  const adminRole = String(adminUser?.role ?? '').toUpperCase();
  return Boolean(adminUser?.isActive && adminRole === 'SUPER_ADMIN');
}

export type JWTPayload = JwtPayload & {
  id?: string;
  iat?: number;
  exp?: number;
};

export interface ImpersonationContext {
  adminUserId:    string;
  adminEmail?:    string;
}

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
  impersonation?: ImpersonationContext;
  /** True when JWT is a tenant impersonation session. */
  isImpersonation?: boolean;
  /** Admin user id from JWT (impersonation issuer). */
  impersonationAdminId?: string;
  perms?: Set<string>;
  can?:   (key: string) => boolean;
}

/** Block mutating billing when acting as a tenant via impersonation. */
export const forbidWhenImpersonating = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  if (req.isImpersonation) {
    res.status(403).json({
      success: false,
      code:    'IMPERSONATION_FORBIDDEN',
      message: 'Bu işlem taklit (impersonation) oturumunda yapılamaz.',
    });
    return;
  }
  next();
};

/** @deprecated Prefer `import { generateToken } from '../utils/jwt.util'` */
export { generateToken } from '../utils/jwt.util';

// Refresh token generation (longer expiry)
export const generateRefreshToken = (userId: string): string => {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    throw new Error('JWT_REFRESH_SECRET environment variable is not set');
  }

  return jwt.sign({ userId }, secret, {
    expiresIn: '7d', // 7 days for refresh token
    issuer: 'woontegra-api',
    audience: 'woontegra-client',
  });
};

// Verify JWT token (core util maps all verify failures to AppError)
export const verifyToken = (token: string): JWTPayload => {
  return coreVerifyToken(token) as JWTPayload;
};

// Verify refresh token
export const verifyRefreshToken = (token: string): { userId: string } => {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    throw new Error('JWT_REFRESH_SECRET environment variable is not set');
  }

  try {
    const decoded = jwt.verify(token, secret) as { userId: string };

    return decoded;
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TokenExpiredError') {
      throw createUnauthorizedError('Refresh token expired');
    }
    if (name === 'JsonWebTokenError' || name === 'NotBeforeError') {
      throw createUnauthorizedError('Invalid refresh token');
    }
    throw createUnauthorizedError('Invalid refresh token');
  }
};

// Authentication middleware
export const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      throw createUnauthorizedError('Authorization header required');
    }

    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      throw createUnauthorizedError('Token required');
    }

    const decoded = verifyToken(token);
    const isImpersonation = isImpersonationToken(decoded);
    const adminId       = resolveImpersonationAdminId(decoded);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId, isActive: true },
      include: { tenant: true },
    });

    if (!user) {
      throw createUnauthorizedError('User not found or inactive');
    }

    if (!user.tenant) {
      throw createUnauthorizedError('User not found or inactive');
    }

    if (!isImpersonation) {
      if (!user.tenant.isActive) {
        throw createUnauthorizedError('User not found or inactive');
      }
    } else {
      if (!user.tenant.isActive) {
        throw createForbiddenError('Askıdaki tenant için oturum açılamaz.');
      }
      if (!(await isValidImpersonationIssuer(adminId))) {
        throw createForbiddenError('Geçersiz veya yetkisiz yönetici oturumu (impersonation).');
      }
      req.impersonation = {
        adminUserId: adminId!,
        adminEmail:  decoded.impersonatedByEmail ?? undefined,
      };
    }

    req.isImpersonation       = isImpersonation;
    req.impersonationAdminId = isImpersonation ? adminId : undefined;

    // Attach user to request
    req.user = {
      userId: user.id,
      id:     user.id,   // convenience alias
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
      isImpersonation:       decoded.isImpersonation,
      adminId:               decoded.adminId ?? decoded.impersonatedBy,
      impersonatedBy:        decoded.impersonatedBy ?? decoded.adminId,
      impersonatedByEmail:   decoded.impersonatedByEmail,
    };

    traceContextFromAuth(req);

    // Log authentication event
    logger.info({
      message: 'User authenticated successfully',
      userId: user.id,
      tenantId: user.tenantId,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
    });

    return next();
  } catch (error) {
    if (error instanceof AppError) {
      // Log authentication failure
      logger.warn({
        message: 'Authentication failed',
        error: error.message,
        code: error.code,
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString(),
      });

      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        code: error.code,
      });
    }

    logger.error({
      message: 'Authentication error (unexpected)',
      err: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      path: req.path,
      method: req.method,
    });

    return res.status(500).json({
      success: false,
      message: 'Authentication error',
      code: 'AUTH_ERROR',
    });
  }
};

// Role-based access control middleware
export const requireRole = (requiredRoles: string | string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
      });
    }

    const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
    
    if (!roles.includes(user.role)) {
      logger.warn({
        message: 'Access denied - insufficient permissions',
        userId: user.userId,
        tenantId: user.tenantId,
        userRole: user.role,
        requiredRoles: roles,
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
      });

      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        requiredRoles: roles,
        currentRole: user.role,
      });
    }

    return next();
  };
};

// Tenant isolation middleware
export const requireTenantAccess = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const user = req.user;

  if (!user || !user.tenantId) {
    return res.status(401).json({
      success: false,
      message: 'Tenant access required',
      code: 'TENANT_ACCESS_REQUIRED',
    });
  }

  // Verify tenant exists and is active
  const tenant = await prisma.tenant.findUnique({
    where: { 
      id: user.tenantId,
      isActive: true,
    },
  });

  if (!tenant) {
    logger.warn({
      message: 'Access denied - tenant not found or inactive',
      tenantId: user.tenantId,
      userId: user.userId,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
    });

    return res.status(403).json({
      success: false,
      message: 'Tenant not found or inactive',
      code: 'TENANT_NOT_FOUND',
    });
  }

  return next();
};

// Optional authentication (doesn't fail if no token)
export const optionalAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return next();
    }

    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return next();
    }

    const decoded = verifyToken(token);
    const isImpersonation = isImpersonationToken(decoded);
    const adminId       = resolveImpersonationAdminId(decoded);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId, isActive: true },
      include: { tenant: true },
    });

    if (user) {
      if (!isImpersonation && !user.tenant.isActive) {
        return next();
      }
      if (isImpersonation && !user.tenant.isActive) {
        return next();
      }
      if (isImpersonation && !(await isValidImpersonationIssuer(adminId))) {
        return next();
      }
      req.isImpersonation       = isImpersonation;
      req.impersonationAdminId = isImpersonation ? adminId : undefined;
      req.user = {
        userId: user.id,
        id:     user.id,
        tenantId: user.tenantId,
        role: user.role,
        email: user.email,
        isImpersonation:       decoded.isImpersonation,
        adminId:               decoded.adminId ?? decoded.impersonatedBy,
        impersonatedBy:        decoded.impersonatedBy ?? decoded.adminId,
        impersonatedByEmail: decoded.impersonatedByEmail,
      };
      if (isImpersonation) {
        req.impersonation = {
          adminUserId: adminId!,
          adminEmail:  decoded.impersonatedByEmail ?? undefined,
        };
      }
    }

    next();
  } catch (error) {
    // If token is invalid, just continue without user
    next();
  }
};

// Helper functions for role checking
export const hasRole = (user: JWTPayload | undefined, role: string): boolean => {
  return user?.role === role;
};

export const hasAnyRole = (user: JWTPayload | undefined, roles: string[]): boolean => {
  return user ? roles.includes(user.role) : false;
};

export const isOwner = (user: JWTPayload | undefined): boolean => {
  return hasRole(user, 'OWNER');
};

export const isAdmin = (user: JWTPayload | undefined): boolean => {
  return hasAnyRole(user, ['ADMIN', 'SUPER_ADMIN', 'OWNER']);
};

export const isStaff = (user: JWTPayload | undefined): boolean => {
  return hasAnyRole(user, ['ADMIN', 'SUPER_ADMIN', 'OWNER', 'MANAGER', 'STAFF']);
};

/** Middleware: only SUPER_ADMIN, OWNER or ADMIN can proceed */
export const requireSuperAdminOrAdmin = (
  req: AuthenticatedRequest, res: Response, next: NextFunction,
) => {
  const role = req.user?.role;
  if (role === 'SUPER_ADMIN' || role === 'OWNER' || role === 'ADMIN') return next();
  return res.status(403).json({ success: false, message: 'Yetersiz yetki.' });
};

/** Middleware: only SUPER_ADMIN (platform); OWNER excluded. */
export const requireSuperAdmin = (
  req: AuthenticatedRequest, res: Response, next: NextFunction,
) => {
  const r = String(req.user?.role || '').toUpperCase();
  if (r === 'SUPER_ADMIN') return next();
  return res.status(403).json({ success: false, message: 'Yalnızca süper admin erişebilir.' });
};
