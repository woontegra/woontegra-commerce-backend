import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

export class LiveSearchController {
  constructor(private prisma: PrismaClient) {}

  async search(req: AuthRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const query = req.query.q as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 20);

      if (!query || query.length < 2) {
        return res.json({
          success: true,
          data: {
            products: [],
            categories: [],
            total: 0,
          },
        });
      }

      // Search products and categories in parallel
      const [products, categories] = await Promise.all([
        this.searchProducts(tenantId, query, limit),
        this.searchCategories(tenantId, query, 5),
      ]);

      res.json({
        success: true,
        data: {
          products,
          categories,
          total: products.length + categories.length,
        },
      });
    } catch (error) {
      console.error('Live search error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async searchProducts(tenantId: string, query: string, limit: number) {
    return this.prisma.product.findMany({
      where: {
        tenantId,
        isActive: true,
        status: 'active',
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { sku: { contains: query, mode: 'insensitive' } },
          { barcode: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        price: true,
        images: true,
        category: {
          select: {
            name: true,
            slug: true,
          },
        },
        stock: {
          select: {
            quantity: true,
          },
        },
      },
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  private async searchCategories(tenantId: string, query: string, limit: number) {
    return this.prisma.category.findMany({
      where: {
        tenantId,
        isActive: true,
        name: { contains: query, mode: 'insensitive' },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        icon: true,
        _count: {
          select: {
            products: {
              where: {
                isActive: true,
                status: 'active',
              },
            },
          },
        },
      },
      take: limit,
      orderBy: {
        name: 'asc',
      },
    });
  }
}
