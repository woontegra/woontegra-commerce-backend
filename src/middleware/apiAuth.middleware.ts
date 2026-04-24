import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface ApiAuthRequest extends Request {
  apiToken?: any;
}

// API Token authentication middleware
export const authenticateApiToken = async (
  req: ApiAuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authorization header required',
        code: 'MISSING_TOKEN'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Find token in database
    const apiToken = await prisma.aPIToken.findUnique({
      where: { token },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!apiToken) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API token',
        code: 'INVALID_TOKEN'
      });
    }

    // Check if token is active
    if (!apiToken.isActive) {
      return res.status(401).json({
        success: false,
        error: 'API token is inactive',
        code: 'TOKEN_INACTIVE'
      });
    }

    // Check if token has expired
    if (apiToken.expiresAt && new Date(apiToken.expiresAt) < new Date()) {
      return res.status(401).json({
        success: false,
        error: 'API token has expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    // Check rate limit
    if (apiToken.currentUsage >= apiToken.rateLimit) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: 60, // Reset after 1 minute
      });
    }

    // Update usage count
    await prisma.aPIToken.update({
      where: { id: apiToken.id },
      data: {
        currentUsage: apiToken.currentUsage + 1,
        lastUsedAt: new Date(),
      },
    });

    // Attach token to request
    req.apiToken = apiToken;

    next();
  } catch (error) {
    console.error('API auth error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
};

// Permission checking middleware
export const requireApiPermission = (permission: string) => {
  return (req: ApiAuthRequest, res: Response, next: NextFunction) => {
    if (!req.apiToken) {
      return res.status(401).json({
        success: false,
        error: 'API token required',
        code: 'TOKEN_REQUIRED'
      });
    }

    const permissions = req.apiToken.permissions as string[];
    
    if (!permissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        required: permission,
        permissions: permissions,
      });
    }

    next();
  };
};

// Rate limiting middleware
export const checkApiRateLimit = async (
  req: ApiAuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.apiToken) {
      return next();
    }

    const token = req.apiToken;
    
    // Check if we need to reset usage (every minute)
    const now = new Date();
    const lastUsed = token.lastUsedAt ? new Date(token.lastUsedAt) : null;
    
    if (lastUsed && (now.getTime() - lastUsed.getTime()) > 60000) {
      // Reset usage if more than 1 minute has passed
      await prisma.aPIToken.update({
        where: { id: token.id },
        data: { currentUsage: 0 },
      });
      
      // Refresh token data
      const updatedToken = await prisma.aPIToken.findUnique({
        where: { id: token.id },
      });
      
      if (updatedToken) {
        req.apiToken = { ...token, ...updatedToken };
      }
    }

    // Check rate limit
    if (req.apiToken.currentUsage >= req.apiToken.rateLimit) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        currentUsage: req.apiToken.currentUsage,
        rateLimit: req.apiToken.rateLimit,
        retryAfter: 60,
      });
    }

    next();
  } catch (error) {
    console.error('Rate limit check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Rate limit check failed',
      code: 'RATE_LIMIT_ERROR'
    });
  }
};
