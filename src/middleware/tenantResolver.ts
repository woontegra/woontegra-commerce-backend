import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
 * Middleware to resolve tenant from domain/subdomain
 * Supports:
 * 1. Subdomain: tenant1.localhost, tenant1.yourdomain.com
 * 2. Custom domain: www.customdomain.com
 */
export async function resolveTenant(req: TenantRequest, res: Response, next: NextFunction) {
  try {
    const host = req.get('host') || '';
    const hostname = host.split(':')[0]; // Remove port if exists
    
    let tenant = null;

    // Check if it's a custom domain first
    tenant = await prisma.tenant.findFirst({
      where: {
        customDomain: hostname,
        domainVerified: true,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        subdomain: true,
        customDomain: true,
      },
    });

    // If not custom domain, check subdomain
    if (!tenant) {
      const parts = hostname.split('.');
      
      // For localhost: tenant1.localhost
      // For production: tenant1.yourdomain.com
      if (parts.length >= 2) {
        const subdomain = parts[0];
        
        // Skip if it's www or api
        if (subdomain !== 'www' && subdomain !== 'api' && subdomain !== 'localhost') {
          tenant = await prisma.tenant.findFirst({
            where: {
              subdomain: subdomain,
              isActive: true,
            },
            select: {
              id: true,
              name: true,
              slug: true,
              subdomain: true,
              customDomain: true,
            },
          });
        }
      }
    }

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found',
        message: 'No tenant found for this domain',
      });
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    console.error('Tenant resolution error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error',
      message: 'Failed to resolve tenant',
    });
  }
}

/**
 * Optional tenant resolver - doesn't fail if tenant not found
 */
export async function optionalTenantResolver(req: TenantRequest, res: Response, next: NextFunction) {
  try {
    const host = req.get('host') || '';
    const hostname = host.split(':')[0];
    
    let tenant = null;

    // Check custom domain
    tenant = await prisma.tenant.findFirst({
      where: {
        customDomain: hostname,
        domainVerified: true,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        subdomain: true,
        customDomain: true,
      },
    });

    // Check subdomain
    if (!tenant) {
      const parts = hostname.split('.');
      if (parts.length >= 2) {
        const subdomain = parts[0];
        if (subdomain !== 'www' && subdomain !== 'api' && subdomain !== 'localhost') {
          tenant = await prisma.tenant.findFirst({
            where: {
              subdomain: subdomain,
              isActive: true,
            },
            select: {
              id: true,
              name: true,
              slug: true,
              subdomain: true,
              customDomain: true,
            },
          });
        }
      }
    }

    if (tenant) {
      req.tenant = tenant;
    }

    next();
  } catch (error) {
    console.error('Optional tenant resolution error:', error);
    next();
  }
}
