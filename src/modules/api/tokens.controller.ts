import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { generateApiToken } from '../../middleware/apiAuth';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

export class ApiTokensController {
  /**
   * GET /api-tokens
   * List all API tokens for the tenant
   */
  async list(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const tokens = await prisma.apiToken.findMany({
        where: { tenantId },
        select: {
          id: true,
          name: true,
          token: true,
          lastUsedAt: true,
          expiresAt: true,
          isActive: true,
          rateLimit: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({
        success: true,
        data: tokens,
      });
    } catch (error) {
      console.error('List API tokens error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  /**
   * POST /api-tokens
   * Create a new API token
   */
  async create(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      const { name, rateLimit = 100, expiresInDays } = req.body;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          message: 'Token name is required',
        });
      }

      const token = generateApiToken();
      let expiresAt = null;

      if (expiresInDays) {
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiresInDays);
      }

      const apiToken = await prisma.apiToken.create({
        data: {
          tenantId,
          name,
          token,
          rateLimit,
          expiresAt,
        },
        select: {
          id: true,
          name: true,
          token: true,
          lastUsedAt: true,
          expiresAt: true,
          isActive: true,
          rateLimit: true,
          createdAt: true,
        },
      });

      return res.status(201).json({
        success: true,
        data: apiToken,
        message: 'API token created successfully. Save this token securely - it will not be shown again.',
      });
    } catch (error) {
      console.error('Create API token error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  /**
   * PATCH /api-tokens/:id
   * Update API token (name, rate limit, active status)
   */
  async update(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;
      const { name, rateLimit, isActive } = req.body;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const token = await prisma.apiToken.findFirst({
        where: { id, tenantId },
      });

      if (!token) {
        return res.status(404).json({
          success: false,
          error: 'Not found',
          message: 'API token not found',
        });
      }

      const updated = await prisma.apiToken.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(rateLimit !== undefined && { rateLimit }),
          ...(isActive !== undefined && { isActive }),
        },
        select: {
          id: true,
          name: true,
          lastUsedAt: true,
          expiresAt: true,
          isActive: true,
          rateLimit: true,
          createdAt: true,
        },
      });

      return res.json({
        success: true,
        data: updated,
        message: 'API token updated successfully',
      });
    } catch (error) {
      console.error('Update API token error:', error);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }

  /**
   * DELETE /api-tokens/:id
   * Delete an API token
   */
  async delete(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const token = await prisma.apiToken.findFirst({
        where: { id, tenantId },
      });

      if (!token) {
        return res.status(404).json({
          success: false,
          error: 'Not found',
          message: 'API token not found',
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
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  }
}
