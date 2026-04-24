import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
    email: string;
  };
}

export class SuperAdminController {
  /**
   * Get all tenants
   */
  async getAllTenants(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { page = 1, limit = 20, search, status } = req.query;

      const where: any = {};

      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: 'insensitive' } },
          { slug: { contains: search as string, mode: 'insensitive' } },
        ];
      }

      if (status) {
        where.status = status;
      }

      const [tenants, total] = await Promise.all([
        prisma.tenant.findMany({
          where,
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          orderBy: { createdAt: 'desc' },
          include: {
            _count: {
              select: {
                users: true,
                products: true,
                orders: true,
              },
            },
          },
        }),
        prisma.tenant.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          tenants,
          pagination: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error) {
      logger.error('[SuperAdmin] Error getting tenants', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get tenant details
   */
  async getTenantDetails(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.params;

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          users: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
              isActive: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              products: true,
              orders: true,
              customers: true,
            },
          },
        },
      });

      if (!tenant) {
        res.status(404).json({ error: 'Tenant not found' });
        return;
      }

      res.json({ success: true, data: tenant });
    } catch (error) {
      logger.error('[SuperAdmin] Error getting tenant details', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update tenant status
   */
  async updateTenantStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.params;
      const { status } = req.body;

      if (!['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'].includes(status)) {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }

      const tenant = await prisma.tenant.update({
        where: { id: tenantId },
        data: { 
          status,
          suspendedAt: status === 'SUSPENDED' ? new Date() : null,
        },
      });

      logger.info('[SuperAdmin] Tenant status updated', {
        tenantId,
        status,
        adminEmail: req.user?.email,
      });

      res.json({ success: true, data: tenant });
    } catch (error) {
      logger.error('[SuperAdmin] Error updating tenant status', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get platform analytics
   */
  async getPlatformAnalytics(req: AuthRequest, res: Response): Promise<void> {
    try {
      const [
        totalTenants,
        activeTenants,
        trialTenants,
        suspendedTenants,
        totalUsers,
        totalProducts,
        totalOrders,
      ] = await Promise.all([
        prisma.tenant.count(),
        prisma.tenant.count({ where: { status: 'ACTIVE' } }),
        prisma.tenant.count({ where: { status: 'TRIAL' } }),
        prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
        prisma.user.count(),
        prisma.product.count(),
        prisma.order.count(),
      ]);

      // Revenue by plan
      const tenantsByPlan = await prisma.user.groupBy({
        by: ['plan'],
        _count: true,
      });

      res.json({
        success: true,
        data: {
          tenants: {
            total: totalTenants,
            active: activeTenants,
            trial: trialTenants,
            suspended: suspendedTenants,
          },
          users: totalUsers,
          products: totalProducts,
          orders: totalOrders,
          planDistribution: tenantsByPlan,
        },
      });
    } catch (error) {
      logger.error('[SuperAdmin] Error getting platform analytics', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get recent activity
   */
  async getRecentActivity(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { limit = 50 } = req.query;

      const recentTenants = await prisma.tenant.findMany({
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
        },
      });

      const recentOrders = await prisma.order.findMany({
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          orderNumber: true,
          total: true,
          status: true,
          createdAt: true,
          tenant: {
            select: {
              name: true,
              slug: true,
            },
          },
        },
      });

      res.json({
        success: true,
        data: {
          recentTenants,
          recentOrders,
        },
      });
    } catch (error) {
      logger.error('[SuperAdmin] Error getting recent activity', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update tenant plan
   */
  async updateTenantPlan(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.params;
      const { plan } = req.body;

      if (!['STARTER', 'PRO', 'ENTERPRISE'].includes(plan)) {
        res.status(400).json({ error: 'Invalid plan' });
        return;
      }

      // Update all users in tenant
      await prisma.user.updateMany({
        where: { tenantId },
        data: { plan },
      });

      logger.info('[SuperAdmin] Tenant plan updated', {
        tenantId,
        plan,
        adminEmail: req.user?.email,
      });

      res.json({ success: true, message: 'Plan updated successfully' });
    } catch (error) {
      logger.error('[SuperAdmin] Error updating tenant plan', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Delete tenant (dangerous!)
   */
  async deleteTenant(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { tenantId } = req.params;
      const { confirm } = req.body;

      if (confirm !== 'DELETE') {
        res.status(400).json({ error: 'Confirmation required' });
        return;
      }

      await prisma.tenant.delete({
        where: { id: tenantId },
      });

      logger.warn('[SuperAdmin] Tenant deleted', {
        tenantId,
        adminEmail: req.user?.email,
      });

      res.json({ success: true, message: 'Tenant deleted successfully' });
    } catch (error) {
      logger.error('[SuperAdmin] Error deleting tenant', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const superAdminController = new SuperAdminController();
