import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

export interface ApiRequest extends Request {
  apiToken?: {
    id:       string;
    tenantId: string;
    rateLimit: number;
    scopes:   string[];
  };
}

/**
 * API Token Authentication Middleware
 * Validates API token from Authorization header: Bearer wnt_...
 */
export async function apiAuth(req: ApiRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error:   'Unauthorized',
        message: 'API token required. Use: Authorization: Bearer YOUR_TOKEN',
      });
    }

    const token    = authHeader.substring(7);
    const apiToken = await prisma.apiToken.findUnique({
      where:  { token },
      select: { id: true, tenantId: true, rateLimit: true, scopes: true, isActive: true, expiresAt: true },
    });

    if (!apiToken) {
      return res.status(401).json({ success: false, error: 'Invalid token', message: 'API token not found' });
    }

    if (!apiToken.isActive) {
      return res.status(401).json({ success: false, error: 'Token disabled', message: 'This API token has been disabled' });
    }

    if (apiToken.expiresAt && new Date() > apiToken.expiresAt) {
      return res.status(401).json({ success: false, error: 'Token expired', message: 'This API token has expired' });
    }

    // Update lastUsedAt async
    prisma.apiToken.update({ where: { id: apiToken.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    req.apiToken = {
      id:        apiToken.id,
      tenantId:  apiToken.tenantId,
      rateLimit: apiToken.rateLimit,
      scopes:    apiToken.scopes,
    };

    next();
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Server error', message: 'Failed to authenticate' });
  }
}

/**
 * requireScope('products:read') — enforces scope on public API routes.
 * Empty scopes array on token = full access (legacy).
 */
export function requireScope(scope: string) {
  return (req: ApiRequest, res: Response, next: NextFunction) => {
    const scopes = req.apiToken?.scopes ?? [];
    // Empty scopes = full access
    if (scopes.length === 0 || scopes.includes(scope) || scopes.includes('*')) {
      return next();
    }
    return res.status(403).json({
      success:  false,
      error:    'Insufficient scope',
      message:  `This token requires the '${scope}' scope.`,
      required: scope,
    });
  };
}

/** Generate a secure API token */
export function generateApiToken(): string {
  return `wnt_${crypto.randomBytes(32).toString('hex')}`;
}
