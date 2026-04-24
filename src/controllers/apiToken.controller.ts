import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Schema validation
const createApiTokenSchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()),
  rateLimit: z.number().min(1).max(1000).default(60),
  expiresAt: z.string().datetime().optional(),
});

export class ApiTokenController {
  // Generate unique API token
  private generateToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = 'wtn_';
    
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return token;
  }

  // Get all API tokens for user
  static async getApiTokens(req: Request, res: Response) {
    try {
      const { page = 1, limit = 50, isActive } = req.query;
      const userId = req.user?.id;

      const where: any = { createdBy: userId };
      if (isActive !== undefined) where.isActive = isActive === 'true';

      const skip = (Number(page) - 1) * Number(limit);

      const [tokens, total] = await Promise.all([
        prisma.aPIToken.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: { createdAt: 'desc' },
          include: {
            creator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        }),
        prisma.aPIToken.count({ where }),
      ]);

      // Don't expose full token in list view
      const safeTokens = tokens.map(token => ({
        ...token,
        token: token.token.substring(0, 20) + '...',
      }));

      res.json({
        success: true,
        data: safeTokens,
        meta: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      console.error('Get API tokens error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch API tokens',
      });
    }
  }

  // Create API token
  static async createApiToken(req: Request, res: Response) {
    try {
      const validatedData = createApiTokenSchema.parse(req.body);
      
      // Generate unique token
      let token = 'wtn_' + crypto.randomBytes(24).toString('base64url');
      
      // Ensure uniqueness
      while (await prisma.aPIToken.findUnique({ where: { token } })) {
        token = 'wtn_' + crypto.randomBytes(24).toString('base64url');
      }

      const apiToken = await prisma.aPIToken.create({
        data: {
          ...validatedData,
          token,
          createdBy: req.user?.id,
          createdAt: new Date(),
        },
        include: {
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      res.status(201).json({
        success: true,
        data: apiToken,
        message: 'API token created successfully',
      });
    } catch (error) {
      console.error('Create API token error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create API token',
      });
    }
  }

  // Update API token
  static async updateApiToken(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { name, permissions, rateLimit, isActive, expiresAt } = req.body;

      const token = await prisma.aPIToken.findUnique({
        where: { id },
      });

      if (!token) {
        return res.status(404).json({
          success: false,
          error: 'API token not found',
        });
      }

      // Check ownership
      if (token.createdBy !== req.user?.id && req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to update this token',
        });
      }

      const updated = await prisma.aPIToken.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(permissions && { permissions }),
          ...(rateLimit !== undefined && { rateLimit }),
          ...(isActive !== undefined && { isActive }),
          ...(expiresAt && { expiresAt: new Date(expiresAt) }),
          updatedAt: new Date(),
        },
      });

      res.json({
        success: true,
        data: updated,
        message: 'API token updated successfully',
      });
    } catch (error) {
      console.error('Update API token error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update API token',
      });
    }
  }

  // Revoke API token
  static async revokeApiToken(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const token = await prisma.aPIToken.findUnique({
        where: { id },
      });

      if (!token) {
        return res.status(404).json({
          success: false,
          error: 'API token not found',
        });
      }

      // Check ownership
      if (token.createdBy !== req.user?.id && req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to revoke this token',
        });
      }

      await prisma.aPIToken.update({
        where: { id },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: 'API token revoked successfully',
      });
    } catch (error) {
      console.error('Revoke API token error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to revoke API token',
      });
    }
  }

  // Delete API token
  static async deleteApiToken(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const token = await prisma.aPIToken.findUnique({
        where: { id },
      });

      if (!token) {
        return res.status(404).json({
          success: false,
          error: 'API token not found',
        });
      }

      // Check ownership
      if (token.createdBy !== req.user?.id && req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to delete this token',
        });
      }

      await prisma.aPIToken.delete({
        where: { id },
      });

      res.json({
        success: true,
        message: 'API token deleted successfully',
      });
    } catch (error) {
      console.error('Delete API token error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete API token',
      });
    }
  }

  // Reset token usage (called periodically)
  static async resetTokenUsage(req: Request, res: Response) {
    try {
      // Only admin can reset usage
      if (req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to reset token usage',
        });
      }

      const result = await prisma.aPIToken.updateMany({
        where: { isActive: true },
        data: { currentUsage: 0 },
      });

      res.json({
        success: true,
        message: `Reset usage for ${result.count} active tokens`,
        resetCount: result.count,
      });
    } catch (error) {
      console.error('Reset token usage error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to reset token usage',
      });
    }
  }

  // Get API token statistics
  static async getTokenStats(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const isAdmin = req.user?.role === 'admin';

      const where = isAdmin ? {} : { createdBy: userId };

      const [
        totalTokens,
        activeTokens,
        inactiveTokens,
        expiredTokens,
        usageStats,
      ] = await Promise.all([
        prisma.aPIToken.count({ where }),
        prisma.aPIToken.count({ 
          where: { ...where, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }
        }),
        prisma.aPIToken.count({ where: { ...where, isActive: false } }),
        prisma.aPIToken.count({ 
          where: { ...where, expiresAt: { lt: new Date() } }
        }),
        prisma.aPIToken.aggregate({
          where,
          _sum: { currentUsage: true, rateLimit: true },
          _avg: { currentUsage: true, rateLimit: true },
        }),
      ]);

      res.json({
        success: true,
        data: {
          total: totalTokens,
          active: activeTokens,
          inactive: inactiveTokens,
          expired: expiredTokens,
          totalUsage: usageStats._sum.currentUsage || 0,
          avgRateLimit: usageStats._avg.rateLimit || 0,
          avgUsage: usageStats._avg.currentUsage || 0,
        },
      });
    } catch (error) {
      console.error('Get token stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch token statistics',
      });
    }
  }
}
