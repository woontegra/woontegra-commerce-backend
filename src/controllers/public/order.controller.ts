import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ApiAuthRequest } from '../../middleware/apiAuth.middleware';

const prisma = new PrismaClient();

// Schema validation
const createOrderSchema = z.object({
  customerEmail: z.string().email(),
  customerName: z.string().min(1),
  customerPhone: z.string().optional(),
  shippingAddress: z.object({
    fullName: z.string().min(1),
    addressLine1: z.string().min(1),
    city: z.string().min(1),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().default('Turkey'),
    phone: z.string().optional(),
  }),
  billingAddress: z.object({
    fullName: z.string().min(1),
    addressLine1: z.string().min(1),
    city: z.string().min(1),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().default('Turkey'),
  }),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().min(1),
    price: z.number().min(0),
  })).min(1),
  notes: z.string().optional(),
});

const updateOrderSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']),
  trackingNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const getOrders = async (req: ApiAuthRequest, res: Response) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      customerEmail,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const where: any = {};

    if (status) where.status = status;
    if (customerEmail) where.customerEmail = { contains: customerEmail as string, mode: 'insensitive' };

    // Date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sortBy as string]: sortOrder },
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
          _count: {
            select: {
              items: true,
            },
          },
        },
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      success: true,
      data: orders,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders',
    });
  }
};

export const getOrder = async (req: ApiAuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                images: true,
                price: true,
              },
            },
          },
        },
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      });
    }

    return res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error('Get order error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch order',
    });
  }
};

export const createOrder = async (req: ApiAuthRequest, res: Response) => {
  try {
    const validatedData = createOrderSchema.parse(req.body);

    // Calculate totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of validatedData.items) {
      // Check product exists and get current price
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
        include: { stock: true },
      });

      if (!product) {
        return res.status(400).json({
          success: false,
          error: `Product not found: ${item.productId}`,
        });
      }

      if (product.status !== 'active') {
        return res.status(400).json({
          success: false,
          error: `Product is not active: ${product.name}`,
        });
      }

      const availableStock = product.stock ? product.stock.quantity - product.stock.reservedQuantity : 0;
      if (availableStock < item.quantity) {
        return res.status(400).json({
          success: false,
          error: `Insufficient stock for ${product.name}. Available: ${availableStock}, Requested: ${item.quantity}`,
        });
      }

      const itemPrice = item.price || product.price;
      const itemTotal = itemPrice * item.quantity;
      subtotal += itemTotal;

      orderItems.push({
        productId: item.productId,
        productName: product.name,
        productSku: product.sku,
        quantity: item.quantity,
        price: itemPrice,
        total: itemTotal,
      });
    }

    // Create order
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-${Date.now()}`,
        customerEmail: validatedData.customerEmail,
        customerName: validatedData.customerName,
        customerPhone: validatedData.customerPhone,
        shippingAddress: validatedData.shippingAddress,
        billingAddress: validatedData.billingAddress,
        subtotal,
        shippingCost: 0, // Calculate based on shipping rules
        discount: 0, // Apply discount rules
        total: subtotal,
        status: 'PENDING',
        source: 'api',
        notes: validatedData.notes,
        createdAt: new Date(),
      },
    });

    // Create order items
    await prisma.orderItem.createMany({
      data: orderItems.map(item => ({
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
        total: item.total,
      })),
    });

    // Reserve stock
    for (const item of validatedData.items) {
      await prisma.stock.updateMany({
        where: { productId: item.productId },
        data: {
          reservedQuantity: {
            increment: item.quantity,
          },
        },
      });
    }

    // Log the activity
    await prisma.activityLog.create({
      data: {
        userId: req.apiToken?.tenantId || 'system',
        userName: 'API',
        userEmail: '',
        userRole: 'api',
        type: 'order',
        action: 'create',
        description: `Order created via API: ${order.orderNumber}`,
        targetType: 'order',
        targetId: order.id,
        targetName: order.orderNumber,
        status: 'success',
        tenantId: req.apiToken?.tenantId || 'system',
      },
    });

    return res.status(201).json({
      success: true,
      data: order,
      message: 'Order created successfully',
    });
  } catch (error) {
    console.error('Create order error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create order',
    });
  }
};

export const updateOrder = async (req: ApiAuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const validatedData = updateOrderSchema.parse(req.body);

    const order = await prisma.order.findUnique({
      where: { id },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      });
    }

    const updated = await prisma.order.update({
      where: { id },
      data: {
        ...validatedData,
        updatedAt: new Date(),
      },
    });

    // If order is being shipped, consume stock
    if (validatedData.status === 'SHIPPED' && order.status !== 'SHIPPED') {
      const orderItems = await prisma.orderItem.findMany({
        where: { orderId: id },
      });

      for (const item of orderItems) {
        await prisma.stock.updateMany({
          where: { productId: item.productId },
          data: {
            quantity: {
              decrement: item.quantity,
            },
            reservedQuantity: {
              decrement: item.quantity,
            },
          },
        });
      }
    }

    // Log the activity
    await prisma.activityLog.create({
      data: {
        userId: req.apiToken?.tenantId || 'system',
        userName: 'API',
        userEmail: '',
        userRole: 'api',
        type: 'order',
        action: 'update',
        description: `Order updated via API: ${updated.orderNumber} - Status: ${validatedData.status}`,
        targetType: 'order',
        targetId: updated.id,
        targetName: updated.orderNumber,
        status: 'success',
        tenantId: req.apiToken?.tenantId || 'system',
      },
    });

    return res.json({
      success: true,
      data: updated,
      message: 'Order updated successfully',
    });
  } catch (error) {
    console.error('Update order error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update order',
    });
  }
};
