import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiAuthRequest } from '../../middleware/apiAuth.middleware';
import prisma from '../../config/database';
import { AppError } from '../../common/middleware/AppError';
import {
  checkProductLimit,
  PLAN_LIMIT_EXCEEDED,
  PLAN_LIMIT_EXCEEDED_MESSAGE,
} from '../../services/planQuota.service';
import { generateUniqueProductSlug } from '../../common/utils/slug.utils';

// Schema validation
const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().optional(),
  description: z.string().optional(),
  price: z.number().min(0),
  compareAtPrice: z.number().min(0).optional(),
  stock: z.number().min(0).default(0),
  status: z.enum(['active', 'draft', 'archived']).default('draft'),
  categoryId: z.string().optional(),
  images: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  weight: z.number().optional(),
  dimensions: z.object({
    length: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional(),
});

const updateProductSchema = createProductSchema.partial();

export const getProducts = async (req: ApiAuthRequest, res: Response) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      category,
      status,
      minPrice,
      maxPrice,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const where: any = {};

    // Search filters
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { sku: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    if (category) where.categoryId = category;
    if (status) where.status = status;

    // Price range
    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = Number(minPrice);
      if (maxPrice) where.price.lte = Number(maxPrice);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sortBy as string]: sortOrder },
        include: {
          category: {
            select: {
              id: true,
              name: true,
            },
          },
          stock: {
            select: {
              quantity: true,
              lowStockThreshold: true,
            },
          },
          _count: {
            select: {
              orderItems: true,
            },
          },
        },
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      success: true,
      data: products,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products',
    });
  }
};

export const getProduct = async (req: ApiAuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        stock: {
          select: {
            quantity: true,
            reservedQuantity: true,
            lowStockThreshold: true,
          },
        },
        variants: {
          where: { status: 'active' },
          orderBy: { createdAt: 'asc' },
        },
        images: {
          orderBy: { position: 'asc' },
        },
        _count: {
          select: {
            orderItems: true,
            reviews: true,
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
      });
    }

    res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product',
    });
  }
};

export const createProduct = async (req: ApiAuthRequest, res: Response) => {
  try {
    const tenantId = req.apiToken?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, error: 'Unauthorized', code: 'MISSING_TENANT' });
    }

    const validatedData = createProductSchema.parse(req.body);

    try {
      await checkProductLimit(tenantId, 1);
    } catch (e) {
      if (e instanceof AppError && e.code === PLAN_LIMIT_EXCEEDED) {
        return res.status(403).json({
          success: false,
          code:    PLAN_LIMIT_EXCEEDED,
          error:   PLAN_LIMIT_EXCEEDED_MESSAGE,
        });
      }
      throw e;
    }

    if (validatedData.sku) {
      const existingProduct = await prisma.product.findFirst({
        where: { sku: validatedData.sku, tenantId },
      });

      if (existingProduct) {
        return res.status(400).json({
          success: false,
          error: 'Product with this SKU already exists',
        });
      }
    }

    const slug  = await generateUniqueProductSlug(validatedData.name, tenantId);
    const price = new Prisma.Decimal(validatedData.price);

    const product = await prisma.product.create({
      data: {
        name:        validatedData.name,
        slug,
        description: validatedData.description ?? null,
        price,
        sku:         validatedData.sku ?? null,
        tenantId,
        images:      validatedData.images ?? [],
        status:      validatedData.status,
        isActive:    validatedData.status === 'active',
        categoryId:  validatedData.categoryId ?? null,
        basePrice:   validatedData.compareAtPrice != null
          ? new Prisma.Decimal(validatedData.compareAtPrice)
          : null,
        pricing: {
          create: {
            salePrice:     price,
            discountPrice: null,
            vatRate:       new Prisma.Decimal(18),
            currency:      'TRY',
          },
        },
        ...(validatedData.weight != null || validatedData.dimensions
          ? {
              shipping: {
                create: {
                  ...(validatedData.weight != null
                    ? { weight: new Prisma.Decimal(validatedData.weight) }
                    : {}),
                  ...(validatedData.dimensions
                    ? {
                        length: new Prisma.Decimal(validatedData.dimensions.length),
                        width:  new Prisma.Decimal(validatedData.dimensions.width),
                        height: new Prisma.Decimal(validatedData.dimensions.height),
                      }
                    : {}),
                },
              },
            }
          : {}),
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        pricing: true,
      },
    });

    if (validatedData.stock > 0) {
      await prisma.stock.create({
        data: {
          productId: product.id,
          tenantId,
          quantity:  new Prisma.Decimal(validatedData.stock),
          updatedAt: new Date(),
        },
      });
    }

    // Log the activity
    await prisma.activityLog.create({
      data: {
        userId: req.apiToken?.creator.id,
        userName: `${req.apiToken?.creator.firstName} ${req.apiToken?.creator.lastName}`,
        userEmail: req.apiToken?.creator.email,
        userRole: req.apiToken?.creator.role,
        type: 'product',
        action: 'create',
        description: `Product created via API: ${product.name}`,
        targetType: 'product',
        targetId: product.id,
        targetName: product.name,
        status: 'success',
        timestamp: new Date(),
        tenant: { connect: { id: tenantId } },
      },
    });

    res.status(201).json({
      success: true,
      data: product,
      message: 'Product created successfully',
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create product',
    });
  }
};

export const updateProduct = async (req: ApiAuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const validatedData = updateProductSchema.parse(req.body);

    const product = await prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
      });
    }

    // Check SKU uniqueness if being updated
    if (validatedData.sku && validatedData.sku !== product.sku) {
      const existingProduct = await prisma.product.findUnique({
        where: { sku: validatedData.sku },
      });

      if (existingProduct) {
        return res.status(400).json({
          success: false,
          error: 'Product with this SKU already exists',
        });
      }
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...validatedData,
        updatedAt: new Date(),
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Update stock if provided
    if (validatedData.stock !== undefined) {
      await prisma.stock.upsert({
        where: { productId: id },
        update: {
          quantity: validatedData.stock,
          updatedAt: new Date(),
        },
        create: {
          productId: id,
          quantity: validatedData.stock,
          updatedAt: new Date(),
        },
      });
    }

    // Log the activity
    await prisma.activityLog.create({
      data: {
        userId: req.apiToken?.creator.id,
        userName: `${req.apiToken?.creator.firstName} ${req.apiToken?.creator.lastName}`,
        userEmail: req.apiToken?.creator.email,
        userRole: req.apiToken?.creator.role,
        type: 'product',
        action: 'update',
        description: `Product updated via API: ${updated.name}`,
        targetType: 'product',
        targetId: updated.id,
        targetName: updated.name,
        changes: validatedData,
        status: 'success',
        timestamp: new Date(),
      },
    });

    res.json({
      success: true,
      data: updated,
      message: 'Product updated successfully',
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update product',
    });
  }
};
