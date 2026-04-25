import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

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
const createActivityLogSchema = z.object({
  type: z.string(),
  action: z.string(),
  description: z.string(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  targetName: z.string().optional(),
  changes: z.any().optional(),
  metadata: z.any().optional(),
  status: z.string().default('success'),
  errorMessage: z.string().optional(),
});

export class ActivityLogController {
  // Get all activity logs with filtering
  static async getActivityLogs(req: AuthRequest, res: Response) {
    try {
      const {
        page = 1,
        limit = 50,
        type,
        action,
        userId,
        status,
        startDate,
        endDate,
      } = req.query;

      const where: any = {};

      if (type) where.type = type;
      if (action) where.action = action;
      if (userId) where.userId = userId;
      if (status) where.status = status;

      if (startDate || endDate) {
        where.timestamp = {};
        if (startDate) where.timestamp.gte = new Date(startDate as string);
        if (endDate) where.timestamp.lte = new Date(endDate as string);
      }

      const skip = (Number(page) - 1) * Number(limit);

      const [logs, total] = await Promise.all([
        prisma.activityLog.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: { timestamp: 'desc' },
          // Note: user relation is not defined in ActivityLog model
        }),
        prisma.activityLog.count({ where }),
      ]);

      res.json({
        success: true,
        data: logs,
        meta: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      console.error('Get activity logs error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch activity logs',
      });
    }
  }

  // Create activity log
  static async createActivityLog(req: AuthRequest, res: Response) {
    try {
      const validatedData = createActivityLogSchema.parse(req.body);
      
      const log = await prisma.activityLog.create({
        data: {
          ...validatedData,
          userId: req.user?.id,
          userName: req.user?.firstName + ' ' + req.user?.lastName,
          userEmail: req.user?.email,
          userRole: req.user?.role,
          tenantId: (req as any).user?.tenantId || 'system',
        },
      });

      res.status(201).json({
        success: true,
        data: log,
      });
    } catch (error) {
      console.error('Create activity log error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create activity log',
      });
    }
  }

  // Get activity log statistics
  static async getLogStats(req: AuthRequest, res: Response) {
    try {
      const { startDate, endDate } = req.query;
      
      const where: any = {};
      if (startDate || endDate) {
        where.timestamp = {};
        if (startDate) where.timestamp.gte = new Date(Array.isArray(startDate) ? startDate[0] as string : startDate as string);
        if (endDate) where.timestamp.lte = new Date(Array.isArray(endDate) ? endDate[0] as string : endDate as string);
      }

      const [
        totalLogs,
        successLogs,
        failedLogs,
        typeStats,
        actionStats,
        userStats,
      ] = await Promise.all([
        prisma.activityLog.count({ where }),
        prisma.activityLog.count({ where: { ...where, status: 'success' } }),
        prisma.activityLog.count({ where: { ...where, status: 'failed' } }),
        prisma.activityLog.groupBy({
          by: ['type'],
          where,
          _count: true,
          orderBy: { _count: { type: 'desc' } },
        }),
        prisma.activityLog.groupBy({
          by: ['action'],
          where,
          _count: true,
          orderBy: { _count: { type: 'desc' } },
        }),
        prisma.activityLog.groupBy({
          by: ['userId'],
          where,
          _count: true,
          orderBy: { _count: { type: 'desc' } },
          take: 10,
        }),
      ]);

      res.json({
        success: true,
        data: {
          total: totalLogs,
          success: successLogs,
          failed: failedLogs,
          successRate: totalLogs > 0 ? (successLogs / totalLogs) * 100 : 0,
          typeStats: typeStats.map(stat => ({
            type: stat.type,
            count: stat._count,
          })),
          actionStats: actionStats.map(stat => ({
            action: stat.action,
            count: stat._count,
          })),
          topUsers: userStats.map(stat => ({
            userId: stat.userId,
            count: stat._count,
          })),
        },
      });
    } catch (error) {
      console.error('Get log stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch log statistics',
      });
    }
  }

  // Delete activity log (admin only)
  static async deleteActivityLog(req: AuthRequest, res: Response) {
    try {
      const id = req.params.id as string;

      const log = await prisma.activityLog.findUnique({
        where: { id },
      });

      if (!log) {
        return res.status(404).json({
          success: false,
          error: 'Activity log not found',
        });
      }

      await prisma.activityLog.delete({
        where: { id },
      });

      return res.json({
        success: true,
        message: 'Activity log deleted successfully',
      });
    } catch (error) {
      console.error('Delete activity log error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete activity log',
      });
    }
  }

  // Bulk delete activity logs (admin only)
  static async bulkDeleteActivityLogs(req: AuthRequest, res: Response) {
    try {
      const { ids, olderThan } = req.body;

      let where: any = {};

      if (ids && Array.isArray(ids)) {
        where.id = { in: ids };
      } else if (olderThan) {
        where.timestamp = { lt: new Date(olderThan as string) };
      } else {
        return res.status(400).json({
          success: false,
          error: 'Either ids array or olderThan date is required',
        });
      }

      const result = await prisma.activityLog.deleteMany({ where });

      return res.json({
        success: true,
        message: `Deleted ${result.count} activity logs`,
        deletedCount: result.count,
      });
    } catch (error) {
      console.error('Bulk delete activity logs error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete activity logs',
      });
    }
  };
};
