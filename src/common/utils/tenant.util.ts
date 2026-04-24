import { Request } from 'express';

interface AuthRequest extends Request {
  user?: { userId: string; tenantId: string; role: string; email: string };
}

/**
 * Extracts tenantId from the authenticated request.
 * Throws if no tenantId is present (should never happen after authenticate middleware).
 */
export function getTenantFromRequest(req: AuthRequest): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    throw new Error('Tenant ID not found in request. Ensure authenticate middleware is applied.');
  }
  return tenantId;
}
