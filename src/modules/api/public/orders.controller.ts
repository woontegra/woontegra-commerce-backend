import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiRequest } from '../../../middleware/apiAuth';

const prisma = new PrismaClient();

export class PublicOrdersController {
  /**
   * POST /api/v1/orders
   * Create a new order
   */
  async create(req: ApiRequest, res: Response) {
    try {
      const tenantId = req.apiToken?.tenantId;
      const { customerId, items, shippingAddress, notes } = req.body;

      // Validate required fields
      if (!customerId || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          message: 'customerId and items are required',
        });
      }

      // Verify customer belongs to tenant
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
      });

      if (!customer) {
        return res.status(404).json({
          success: false,
          error: 'Not found',
          message: 'Customer not found',
        });
      }

      // Calculate total and validate products
      let total = 0;
      const orderItems = [];

      for (const item of items) {
        const product = await prisma.product.findFirst({
          where: {
            id: item.productId,
            tenantId,
            isActive: true,
          },
        });

        if (!product) {
          return res.status(404).json({
            success: false,
            error: 'Not found',
            message: `Product ${item.productId} not found`,
          });
        }

        if (product.stock < item.quantity) {
          return res.status(400).json({
            success: false,
            error: 'Insufficient stock',
            message: `Product ${product.name} has insufficient stock`,
          });
        }

        const itemTotal = product.price * item.quantity;
        total += itemTotal;

        orderItems.push({
          productId: product.id,
          quantity: item.quantity,
          price: product.price,
        });
      }

      // Create order
      const order = await prisma.order.create({
        data: {
          tenantId,
          customerId,
          total,
          status: 'PENDING',
          shippingAddress: shippingAddress || customer.address,
          notes,
          items: {
            create: orderItems,
          },
        },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                },
              },
            },
          },
          customer: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      // Update product stock
      for (const item of orderItems) {
        await prisma.product.update({
          where: { id: item.productId },
          data: {
            stock: {
              decrement: item.quantity,
            },
          },
        });
      }

      return res.status(201).json({
        success: true,
        data: order,
        message: 'Order created successfully',
      });
    } catch (error) {
      console.error('Public API - Create order error:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error',
        message: 'Failed to create order',
      });
    }
  }

  /**
   * GET /api/v1/orders/:id
   * Get order by ID
   */
  async getById(req: ApiRequest, res: Response) {
    try {
      const tenantId = req.apiToken?.tenantId;
      const { id } = req.params;

      const order = await prisma.order.findFirst({
        where: {
          id,
          tenantId,
        },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  images: true,
                },
              },
            },
          },
          customer: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Not found',
          message: 'Order not found',
        });
      }

      return res.json({
        success: true,
        data: order,
      });
    } catch (error) {
      console.error('Public API - Get order error:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error',
        message: 'Failed to fetch order',
      });
    }
  }

  /**
   * GET /api/v1/orders
   * List orders with filters
   */
  async list(req: ApiRequest, res: Response) {
    try {
      const tenantId = req.apiToken?.tenantId;
      const { page = '1', limit = '20', status, customerId } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = Math.min(parseInt(limit as string), 100);
      const skip = (pageNum - 1) * limitNum;

      const where: any = { tenantId };

      if (status) {
        where.status = status;
      }

      if (customerId) {
        where.customerId = customerId;
      }

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          skip,
          take: limitNum,
          include: {
            customer: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
            items: {
              select: {
                id: true,
                quantity: true,
                price: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.order.count({ where }),
      ]);

      return res.json({
        success: true,
        data: orders,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error('Public API - List orders error:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error',
        message: 'Failed to fetch orders',
      });
    }
  }
}
