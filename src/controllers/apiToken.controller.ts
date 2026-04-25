import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Extended request type with user
interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  };
}

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
  static async getApiTokens(req: AuthRequest, res: Response) {
    try {
      const { page = 1, limit = 50, isActive } = req.query;
      const userId = req.user?.id;

      const where: any = { tenantId: req.user?.tenantId };
      if (isActive !== undefined) where.isActive = isActive === 'true';

      const skip = (Number(page) - 1) * Number(limit);

      const [tokens, total] = await Promise.all([
        prisma.apiToken.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: { createdAt: 'desc' },
        }),
        prisma.apiToken.count({ where }),
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
      while (await prisma.apiToken.findUnique({ where: { token } })) {
        token = 'wtn_' + crypto.randomBytes(24).toString('base64url');
      }

      const apiToken = await prisma.apiToken.create({
        data: {
          ...validatedData,
          token,
          tenantId: req.user!.tenantId,
          scopes: validatedData.permissions || [],
        },
      });

      return res.status(201).json({
        success: true,
        data: apiToken,
        message: 'API token created successfully',
      });
    } catch (error) {
      console.error('Create API token error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to create API token',
      });
    }
  };

  // Update API token
  static async updateApiToken(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const { name, permissions, rateLimit, isActive, expiresAt } = req.body;

      const token = await prisma.apiToken.findUnique({
        where: { id },
      });

      if (!token) {
        return res.status(404).json({
          success: false,
          error: 'API token not found',
        });
      }

      // Check ownership - only tenant admin can update
      if (token.tenantId !== req.user?.tenantId && req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to update this token',
        });
      }

      const updated = await prisma.apiToken.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(permissions && { scopes: permissions }),
          ...(rateLimit !== undefined && { rateLimit }),
          ...(isActive !== undefined && { isActive }),
          ...(expiresAt && { expiresAt: new Date(expiresAt) }),
        },
      });

      return res.json({
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
  static async revokeApiToken(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;

      const token = await prisma.apiToken.findUnique({
        where: { id },
      });

      if (!token) {
        return res.status(404).json({
          success: false,
          error: 'API token not found',
        });
      }

      // Check ownership - only tenant admin can revoke
      if (token.tenantId !== req.user?.tenantId && req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to revoke this token',
        });
      }

      await prisma.apiToken.update({
        where: { id },
        data: {
          isActive: false,
        },
      });

      return res.json({
        success: true,
        message: 'API token revoked successfully',
      });
    } catch (error) {
      console.error('Revoke API token error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to revoke API token',
      });
    }
  };

  // Delete API token
  static async deleteApiToken(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;

      const token = await prisma.apiToken.findUnique({
        where: { id },
      });

      if (!token) {
        return res.status(404).json({
          success: false,
          error: 'API token not found',
        });
      }

      // Check ownership - only tenant admin can delete
      if (token.tenantId !== req.user?.tenantId && req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to delete this token',
        });
      }

      await prisma.apiToken.delete({
        where: { id },
      });

      return res.json({
        success: true,
        message: 'API token deleted successfully',
      });
    } catch (error) {
      console.error('Delete API token error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete API token',
      });
    }
  }

  // Reset token usage (called periodically)
  static async resetTokenUsage(req: AuthRequest, res: Response) {
    try {
      // Only admin can reset usage
      if (req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to reset token usage',
        });
      }

      // Note: ApiToken model doesn't have currentUsage field
      // This endpoint returns success for compatibility
      return res.json({
        success: true,
        message: 'Token usage tracking not implemented',
      });
    } catch (error) {
      console.error('Reset token usage error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to reset token usage',
      });
    }
  };

  // Get API token statistics
  static async getTokenStats(req: AuthRequest, res: Response) {
    try {
      const isAdmin = req.user?.role === 'admin';

      const where = isAdmin ? {} : { tenantId: req.user?.tenantId };

      const [
        totalTokens,
        activeTokens,
        inactiveTokens,
        expiredTokens,
      ] = await Promise.all([
        prisma.apiToken.count({ where }),
        prisma.apiToken.count({ 
          where: { ...where, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }
        }),
        prisma.apiToken.count({ where: { ...where, isActive: false } }),
        prisma.apiToken.count({ 
          where: { ...where, expiresAt: { lt: new Date() } }
        }),
      ]);

      return res.json({
        success: true,
        data: {
          total: totalTokens,
          active: activeTokens,
          inactive: inactiveTokens,
          expired: expiredTokens,
        },
      });
    } catch (error) {
      console.error('Get token stats error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch token statistics',
      });
    }
  };
};
