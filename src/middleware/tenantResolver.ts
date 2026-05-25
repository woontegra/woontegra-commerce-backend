import { Request, Response, NextFunction } from 'express';
import { resolveTenantFromHost } from '../services/tenantDomainResolve.service';

export interface TenantRequest extends Request {
  tenant?: {
    id: string;
    name: string;
    slug: string;
    subdomain: string | null;
    customDomain: string | null;
  };
}

/**
 * Host üzerinden tenant çözümler (tenant_domains öncelikli, tenants legacy yedek).
 */
export async function resolveTenant(req: TenantRequest, res: Response, next: NextFunction) {
  try {
    const host = req.get('host') || '';
    const tenant = await resolveTenantFromHost(host);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error:   'Tenant not found',
        message: 'No tenant found for this domain',
      });
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    console.error('Tenant resolution error:', error);
    return res.status(500).json({
      success: false,
      error:   'Server error',
      message: 'Failed to resolve tenant',
    });
  }
}

export async function optionalTenantResolver(req: TenantRequest, res: Response, next: NextFunction) {
  try {
    const host = req.get('host') || '';
    const tenant = await resolveTenantFromHost(host);
    if (tenant) {
      req.tenant = tenant;
    }
    next();
  } catch (error) {
    console.error('Optional tenant resolution error:', error);
    next();
  }
}
