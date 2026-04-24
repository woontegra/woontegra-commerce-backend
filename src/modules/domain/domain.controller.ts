import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import dns from 'dns';
import { promisify } from 'util';

const prisma = new PrismaClient();
const resolveTxt = promisify(dns.resolveTxt);

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

export class DomainController {
  // Get current domain settings
  async getDomainSettings(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          subdomain: true,
          customDomain: true,
          domainVerified: true,
        },
      });

      if (!tenant) {
        return res.status(404).json({ success: false, error: 'Tenant not found' });
      }

      return res.json({
        success: true,
        data: {
          subdomain: tenant.subdomain,
          customDomain: tenant.customDomain,
          domainVerified: tenant.domainVerified,
          verificationRecord: tenant.customDomain ? `woontegra-verify=${tenantId}` : null,
        },
      });
    } catch (error) {
      console.error('Get domain settings error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  // Update subdomain
  async updateSubdomain(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      const { subdomain } = req.body;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      // Validate subdomain format
      const subdomainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
      if (!subdomainRegex.test(subdomain)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid subdomain format',
          message: 'Subdomain must contain only lowercase letters, numbers, and hyphens',
        });
      }

      // Reserved subdomains
      const reserved = ['www', 'api', 'admin', 'app', 'mail', 'ftp', 'localhost'];
      if (reserved.includes(subdomain)) {
        return res.status(400).json({
          success: false,
          error: 'Reserved subdomain',
          message: 'This subdomain is reserved',
        });
      }

      // Check if subdomain is already taken
      const existing = await prisma.tenant.findFirst({
        where: {
          subdomain,
          id: { not: tenantId },
        },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'Subdomain taken',
          message: 'This subdomain is already in use',
        });
      }

      const tenant = await prisma.tenant.update({
        where: { id: tenantId },
        data: { subdomain },
        select: {
          subdomain: true,
          customDomain: true,
          domainVerified: true,
        },
      });

      return res.json({
        success: true,
        data: tenant,
        message: 'Subdomain updated successfully',
      });
    } catch (error) {
      console.error('Update subdomain error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  // Add custom domain
  async addCustomDomain(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      const { customDomain } = req.body;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      // Check if user's plan allows custom domain
      const user = await prisma.user.findFirst({
        where: { id: req.user?.id },
        select: { plan: true },
      });

      if (user?.plan !== 'ENTERPRISE') {
        return res.status(403).json({
          success: false,
          error: 'Plan upgrade required',
          message: 'Custom domains are only available on Enterprise plan',
        });
      }

      // Validate domain format
      const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
      if (!domainRegex.test(customDomain)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid domain format',
          message: 'Please enter a valid domain name',
        });
      }

      // Check if domain is already taken
      const existing = await prisma.tenant.findFirst({
        where: {
          customDomain,
          id: { not: tenantId },
        },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'Domain taken',
          message: 'This domain is already in use',
        });
      }

      const tenant = await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          customDomain,
          domainVerified: false,
        },
        select: {
          subdomain: true,
          customDomain: true,
          domainVerified: true,
        },
      });

      return res.json({
        success: true,
        data: tenant,
        message: 'Custom domain added. Please verify DNS settings.',
        verificationRecord: `woontegra-verify=${tenantId}`,
      });
    } catch (error) {
      console.error('Add custom domain error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  // Verify custom domain
  async verifyCustomDomain(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { customDomain: true },
      });

      if (!tenant?.customDomain) {
        return res.status(400).json({
          success: false,
          error: 'No custom domain',
          message: 'No custom domain configured',
        });
      }

      try {
        // Check TXT record for verification
        const records = await resolveTxt(tenant.customDomain);
        const verificationString = `woontegra-verify=${tenantId}`;
        const verified = records.some(record => 
          record.some(txt => txt.includes(verificationString))
        );

        if (verified) {
          await prisma.tenant.update({
            where: { id: tenantId },
            data: { domainVerified: true },
          });

          return res.json({
            success: true,
            message: 'Domain verified successfully',
            verified: true,
          });
        } else {
          return res.json({
            success: false,
            message: 'Verification record not found',
            verified: false,
            expectedRecord: verificationString,
          });
        }
      } catch (dnsError) {
        return res.json({
          success: false,
          message: 'DNS lookup failed. Please check your DNS settings.',
          verified: false,
        });
      }
    } catch (error) {
      console.error('Verify domain error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  // Remove custom domain
  async removeCustomDomain(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          customDomain: null,
          domainVerified: false,
        },
      });

      return res.json({
        success: true,
        message: 'Custom domain removed successfully',
      });
    } catch (error) {
      console.error('Remove custom domain error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
}
