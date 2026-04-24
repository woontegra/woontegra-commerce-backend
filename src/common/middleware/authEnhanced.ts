import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { createUnauthorizedError, createForbiddenError, AppError } from './AppError';
import { logger } from '../../utils/logger';

const prisma = new PrismaClient();

interface JWTPayload {
  userId: string;
  id?: string;       // alias for userId (set during authenticate)
  tenantId: string;
  role: string;
  email: string;
  iat?: number;
  exp?: number;
}

interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
  perms?: Set<string>;
  can?:   (key: string) => boolean;
}

// JWT token generation with short expiry (15 minutes)
export const generateToken = (payload: Omit<JWTPayload, 'iat' | 'exp'>): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  return jwt.sign(payload, secret, {
    expiresIn: '7d',
  });
};

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

// Verify JWT token
export const verifyToken = (token: string): JWTPayload => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  try {
    const decoded = jwt.verify(token, secret) as JWTPayload;

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw createUnauthorizedError('Token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw createUnauthorizedError('Invalid token');
    } else {
      throw error;
    }
  }
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
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw createUnauthorizedError('Refresh token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw createUnauthorizedError('Invalid refresh token');
    } else {
      throw error;
    }
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
    
    // Verify user exists and is active
    const user = await prisma.user.findUnique({
      where: { 
        id: decoded.userId,
        isActive: true,
        tenant: {
          isActive: true,
        }
      },
      include: {
        tenant: true,
      },
    });

    if (!user) {
      throw createUnauthorizedError('User not found or inactive');
    }

    // Attach user to request
    req.user = {
      userId: user.id,
      id:     user.id,   // convenience alias
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
    };

    // Log authentication event
    logger.info({
      message: 'User authenticated successfully',
      userId: user.id,
      tenantId: user.tenantId,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
    });

    next();
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

    next();
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

  next();
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
    
    // Verify user exists and is active
    const user = await prisma.user.findUnique({
      where: { 
        id: decoded.userId,
        isActive: true,
        tenant: {
          isActive: true,
        }
      },
      include: {
        tenant: true,
      },
    });

    if (user) {
      req.user = {
        userId: user.id,
        id:     user.id,
        tenantId: user.tenantId,
        role: user.role,
        email: user.email,
      };
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
  return hasRole(user, 'ADMIN');
};

export const isStaff = (user: JWTPayload | undefined): boolean => {
  return hasAnyRole(user, ['ADMIN', 'MANAGER', 'STAFF']);
};

/** Middleware: only SUPER_ADMIN or ADMIN can proceed */
export const requireSuperAdminOrAdmin = (
  req: AuthenticatedRequest, res: Response, next: NextFunction,
) => {
  const role = req.user?.role;
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return next();
  return res.status(403).json({ success: false, message: 'Yetersiz yetki.' });
};

/** Middleware: only SUPER_ADMIN can proceed */
export const requireSuperAdmin = (
  req: AuthenticatedRequest, res: Response, next: NextFunction,
) => {
  if (req.user?.role === 'SUPER_ADMIN') return next();
  return res.status(403).json({ success: false, message: 'Yalnızca süper admin erişebilir.' });
};
