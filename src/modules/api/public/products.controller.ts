import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiRequest } from '../../../middleware/apiAuth';

const prisma = new PrismaClient();

export class PublicProductsController {
  /**
   * GET /api/v1/products
   * List all products for the authenticated tenant
   */
  async list(req: ApiRequest, res: Response) {
    try {
      const tenantId = req.apiToken?.tenantId;
      const { page = '1', limit = '20', category, search } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = Math.min(parseInt(limit as string), 100); // Max 100 per page
      const skip = (pageNum - 1) * limitNum;

      const where: any = {
        tenantId,
        isActive: true,
      };

      if (category) {
        where.categoryId = category;
      }

      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: 'insensitive' } },
          { description: { contains: search as string, mode: 'insensitive' } },
        ];
      }

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          skip,
          take: limitNum,
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            price: true,
            images: true,
            stock: true,
            sku: true,
            isActive: true,
            category: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
            variants: {
              select: {
                id: true,
                name: true,
                price: true,
                stock: true,
                sku: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.product.count({ where }),
      ]);

      return res.json({
        success: true,
        data: products,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error('Public API - List products error:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error',
        message: 'Failed to fetch products',
      });
    }
  }

  /**
   * GET /api/v1/products/:id
   * Get a single product by ID or slug
   */
  async getById(req: ApiRequest, res: Response) {
    try {
      const tenantId = req.apiToken?.tenantId;
      const { id } = req.params;

      const product = await prisma.product.findFirst({
        where: {
          OR: [
            { id, tenantId },
            { slug: id, tenantId },
          ],
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          price: true,
          images: true,
          stock: true,
          sku: true,
          isActive: true,
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          variants: {
            select: {
              id: true,
              name: true,
              price: true,
              stock: true,
              sku: true,
            },
          },
        },
      });

      if (!product) {
        return res.status(404).json({
          success: false,
          error: 'Not found',
          message: 'Product not found',
        });
      }

      return res.json({
        success: true,
        data: product,
      });
    } catch (error) {
      console.error('Public API - Get product error:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error',
        message: 'Failed to fetch product',
      });
    }
  }
}
