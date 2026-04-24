import { Request, Response, NextFunction } from 'express';
import { ApiKeyService } from '../../services/api-key.service';
import { logger } from '../../config/logger';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
  apiKey?: any;
}

/**
 * API Key Authentication Middleware
 * Validates API key from Authorization header
 */
export async function authenticateApiKey(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Get API key from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'API key required' });
      return;
    }

    const apiKey = authHeader.substring(7); // Remove 'Bearer '

    // Validate API key
    const validatedKey = await ApiKeyService.validateApiKey(apiKey);

    if (!validatedKey) {
      res.status(401).json({ error: 'Invalid or expired API key' });
      return;
    }

    // Check rate limit
    const withinLimit = await ApiKeyService.checkRateLimit(validatedKey.id);

    if (!withinLimit) {
      res.status(429).json({ 
        error: 'Rate limit exceeded',
        message: `Rate limit: ${validatedKey.rateLimit} requests per minute`,
      });
      return;
    }

    // Attach API key and tenant info to request
    req.apiKey = validatedKey;
    req.user = {
      id: validatedKey.userId || 'api',
      tenantId: validatedKey.tenantId,
      role: 'API',
    };

    next();
  } catch (error) {
    logger.error('[ApiKeyAuth] Error authenticating API key', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Check API key permissions
 */
export function requireApiPermission(resource: string, action: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    try {
      const apiKey = req.apiKey;

      if (!apiKey) {
        res.status(401).json({ error: 'API key required' });
        return;
      }

      // If no permissions set, allow all
      if (!apiKey.permissions) {
        next();
        return;
      }

      const permissions = apiKey.permissions as any;

      // Check if resource exists in permissions
      if (!permissions[resource]) {
        res.status(403).json({ 
          error: 'Forbidden',
          message: `No access to resource: ${resource}`,
        });
        return;
      }

      // Check if action is allowed
      const allowedActions = permissions[resource];
      if (!Array.isArray(allowedActions) || !allowedActions.includes(action)) {
        res.status(403).json({ 
          error: 'Forbidden',
          message: `Action '${action}' not allowed on resource '${resource}'`,
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('[ApiKeyAuth] Error checking permissions', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
