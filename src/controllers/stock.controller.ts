import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

// Schema validation
const updateStockSchema = z.object({
  quantity: z.number().min(0),
  reservedQuantity: z.number().min(0).default(0),
  lowStockThreshold: z.number().min(0).default(10),
});

const bulkUpdateStockSchema = z.object({
  updates: z.array(z.object({
    productId: z.string(),
    quantity: z.number().min(0),
    reservedQuantity: z.number().min(0).default(0),
    lowStockThreshold: z.number().min(0).default(10),
  }))
});

export class StockController {
  // Get all stock records
  static async getStocks(req: Request, res: Response) {
    try {
      const { 
        page = 1, 
        limit = 50, 
        lowStock, 
        productId,
        search 
      } = req.query;

      const where: any = {};

      if (lowStock === 'true') {
        where.OR = [
          {
            AND: [
              { quantity: { lte: prisma.stock.fields.lowStockThreshold } },
              { lowStockThreshold: { gt: 0 } }
            ]
          }
        ];
      }

      if (productId) where.productId = productId;

      if (search) {
        where.product = {
          OR: [
            { name: { contains: search as string, mode: 'insensitive' } },
            { sku: { contains: search as string, mode: 'insensitive' } },
          ]
        };
      }

      const skip = (Number(page) - 1) * Number(limit);

      const [stocks, total] = await Promise.all([
        prisma.stock.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: { updatedAt: 'desc' },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                price: true,
                images: true,
              },
            },
          },
        }),
        prisma.stock.count({ where }),
      ]);

      res.json({
        success: true,
        data: stocks,
        meta: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      console.error('Get stocks error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch stocks',
      });
    }
  }

  // Get single stock record
  static async getStock(req: Request, res: Response) {
    try {
      const { productId } = req.params;

      const stock = await prisma.stock.findUnique({
        where: { productId },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              price: true,
              images: true,
              status: true,
            },
          },
        },
      });

      if (!stock) {
        return res.status(404).json({
          success: false,
          error: 'Stock record not found',
        });
      }

      res.json({
        success: true,
        data: stock,
      });
    } catch (error) {
      console.error('Get stock error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch stock',
      });
    }
  }

  // Update stock
  static async updateStock(req: Request, res: Response) {
    try {
      const { productId } = req.params;
      const validatedData = updateStockSchema.parse(req.body);

      const stock = await prisma.stock.findUnique({
        where: { productId },
      });

      if (!stock) {
        // Create new stock record
        const newStock = await prisma.stock.create({
          data: {
            productId,
            ...validatedData,
            updatedAt: new Date(),
          },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
          },
        });

        return res.status(201).json({
          success: true,
          data: newStock,
          message: 'Stock record created',
        });
      }

      const updated = await prisma.stock.update({
        where: { productId },
        data: {
          ...validatedData,
          updatedAt: new Date(),
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
        },
      });

      res.json({
        success: true,
        data: updated,
        message: 'Stock updated successfully',
      });
    } catch (error) {
      console.error('Update stock error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update stock',
      });
    }
  }

  // Bulk update stocks
  static async bulkUpdateStocks(req: Request, res: Response) {
    try {
      const { updates } = bulkUpdateStockSchema.parse(req.body);

      const results = await Promise.allSettled(
        updates.map(async (update) => {
          const stock = await prisma.stock.findUnique({
            where: { productId: update.productId },
          });

          if (stock) {
            return prisma.stock.update({
              where: { productId: update.productId },
              data: {
                quantity: update.quantity,
                reservedQuantity: update.reservedQuantity,
                lowStockThreshold: update.lowStockThreshold,
                updatedAt: new Date(),
              },
            });
          } else {
            return prisma.stock.create({
              data: {
                productId: update.productId,
                quantity: update.quantity,
                reservedQuantity: update.reservedQuantity,
                lowStockThreshold: update.lowStockThreshold,
                updatedAt: new Date(),
              },
            });
          }
        })
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      res.json({
        success: true,
        message: `Updated ${successful} stocks, ${failed} failed`,
        updated: successful,
        failed,
      });
    } catch (error) {
      console.error('Bulk update stocks error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to bulk update stocks',
      });
    }
  }

  // Reserve stock (for orders)
  static async reserveStock(req: Request, res: Response) {
    try {
      const { productId, quantity } = req.body;

      if (!productId || !quantity || quantity <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Product ID and quantity are required',
        });
      }

      const stock = await prisma.stock.findUnique({
        where: { productId },
      });

      if (!stock) {
        return res.status(404).json({
          success: false,
          error: 'Stock record not found',
        });
      }

      const availableQuantity = stock.quantity - stock.reservedQuantity;
      if (availableQuantity < quantity) {
        return res.status(400).json({
          success: false,
          error: 'Insufficient stock available',
          available: availableQuantity,
          requested: quantity,
        });
      }

      const updated = await prisma.stock.update({
        where: { productId },
        data: {
          reservedQuantity: stock.reservedQuantity + quantity,
          updatedAt: new Date(),
        },
      });

      res.json({
        success: true,
        data: updated,
        message: 'Stock reserved successfully',
      });
    } catch (error) {
      console.error('Reserve stock error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to reserve stock',
      });
    }
  }

  // Release stock (for cancelled orders)
  static async releaseStock(req: Request, res: Response) {
    try {
      const { productId, quantity } = req.body;

      if (!productId || !quantity || quantity <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Product ID and quantity are required',
        });
      }

      const stock = await prisma.stock.findUnique({
        where: { productId },
      });

      if (!stock) {
        return res.status(404).json({
          success: false,
          error: 'Stock record not found',
        });
      }

      if (stock.reservedQuantity < quantity) {
        return res.status(400).json({
          success: false,
          error: 'Cannot release more than reserved quantity',
          reserved: stock.reservedQuantity,
          requested: quantity,
        });
      }

      const updated = await prisma.stock.update({
        where: { productId },
        data: {
          reservedQuantity: stock.reservedQuantity - quantity,
          updatedAt: new Date(),
        },
      });

      res.json({
        success: true,
        data: updated,
        message: 'Stock released successfully',
      });
    } catch (error) {
      console.error('Release stock error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to release stock',
      });
    }
  }

  // Consume stock (for completed orders)
  static async consumeStock(req: Request, res: Response) {
    try {
      const { productId, quantity } = req.body;

      if (!productId || !quantity || quantity <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Product ID and quantity are required',
        });
      }

      const stock = await prisma.stock.findUnique({
        where: { productId },
      });

      if (!stock) {
        return res.status(404).json({
          success: false,
          error: 'Stock record not found',
        });
      }

      if (stock.reservedQuantity < quantity) {
        return res.status(400).json({
          success: false,
          error: 'Insufficient reserved stock',
          reserved: stock.reservedQuantity,
          requested: quantity,
        });
      }

      const updated = await prisma.stock.update({
        where: { productId },
        data: {
          quantity: stock.quantity - quantity,
          reservedQuantity: stock.reservedQuantity - quantity,
          updatedAt: new Date(),
        },
      });

      res.json({
        success: true,
        data: updated,
        message: 'Stock consumed successfully',
      });
    } catch (error) {
      console.error('Consume stock error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to consume stock',
      });
    }
  }

  // Get stock statistics
  static async getStockStats(req: Request, res: Response) {
    try {
      const [
        totalProducts,
        totalStock,
        totalReserved,
        lowStockCount,
        outOfStockCount,
        valueStats,
      ] = await Promise.all([
        prisma.stock.count(),
        prisma.stock.aggregate({ _sum: { quantity: true } }),
        prisma.stock.aggregate({ _sum: { reservedQuantity: true } }),
        prisma.stock.count({
          where: {
            AND: [
              { quantity: { lte: prisma.stock.fields.lowStockThreshold } },
              { lowStockThreshold: { gt: 0 } }
            ]
          }
        }),
        prisma.stock.count({ where: { quantity: 0 } }),
        prisma.stock.aggregate({
          _avg: { quantity: true },
          _min: { quantity: true },
          _max: { quantity: true },
        }),
      ]);

      res.json({
        success: true,
        data: {
          totalProducts,
          totalStock: totalStock._sum.quantity || 0,
          totalReserved: totalReserved._sum.reservedQuantity || 0,
          availableStock: (totalStock._sum.quantity || 0) - (totalReserved._sum.reservedQuantity || 0),
          lowStockCount,
          outOfStockCount,
          averageStock: valueStats._avg.quantity || 0,
          minStock: valueStats._min.quantity || 0,
          maxStock: valueStats._max.quantity || 0,
        },
      });
    } catch (error) {
      console.error('Get stock stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch stock statistics',
      });
    }
  }
}
