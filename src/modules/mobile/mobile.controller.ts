import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger';
import { authenticate } from '../../common/middleware/authEnhanced';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
    email: string;
  };
}

export class MobileController {
  /**
   * Get mobile app configuration
   */
  async getConfig(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.headers['x-tenant-id'] as string;
      
      if (!tenantId) {
        res.status(400).json({ error: 'Tenant ID required' });
        return;
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          name: true,
          slug: true,
          settings: true,
          logo: true,
          theme: true,
        },
      });

      if (!tenant) {
        res.status(404).json({ error: 'Tenant not found' });
        return;
      }

      const settings = tenant.settings as any;
      const mobileConfig = {
        app: {
          name: tenant.name,
          version: '1.0.0',
          buildNumber: 1,
        },
        theme: {
          primaryColor: settings?.mobile?.primaryColor || '#3B82F6',
          secondaryColor: settings?.mobile?.secondaryColor || '#10B981',
          backgroundColor: settings?.mobile?.backgroundColor || '#FFFFFF',
          textColor: settings?.mobile?.textColor || '#1F2937',
          logo: tenant.logo,
        },
        features: {
          enableNotifications: settings?.mobile?.enableNotifications ?? true,
          enableBiometric: settings?.mobile?.enableBiometric ?? false,
          enableDarkMode: settings?.mobile?.enableDarkMode ?? true,
          enableOfflineMode: settings?.mobile?.enableOfflineMode ?? true,
        },
        api: {
          baseUrl: process.env.API_BASE_URL || 'https://api.woontegra.com',
          timeout: 30000,
          retryAttempts: 3,
        },
        payment: {
          providers: settings?.payment?.providers || ['iyzico'],
          currency: settings?.currency || 'TRY',
        },
        localization: {
          defaultLanguage: settings?.localization?.defaultLanguage || 'tr',
          supportedLanguages: settings?.localization?.supportedLanguages || ['tr', 'en'],
        },
      };

      res.json({
        success: true,
        data: mobileConfig,
      });
    } catch (error) {
      logger.error('[Mobile] Error getting config', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get products for mobile app
   */
  async getProducts(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.headers['x-tenant-id'] as string;
      const { 
        page = 1, 
        limit = 20, 
        category, 
        search, 
        sortBy = 'createdAt',
        sortOrder = 'desc',
        minPrice,
        maxPrice 
      } = req.query;

      if (!tenantId) {
        res.status(400).json({ error: 'Tenant ID required' });
        return;
      }

      const whereClause: any = {
        tenantId,
        isActive: true,
      };

      if (category) {
        whereClause.category = {
          slug: category as string,
        };
      }

      if (search) {
        whereClause.OR = [
          { name: { contains: search as string, mode: 'insensitive' } },
          { description: { contains: search as string, mode: 'insensitive' } },
          { sku: { contains: search as string, mode: 'insensitive' } },
        ];
      }

      if (minPrice || maxPrice) {
        whereClause.pricing = {};
        if (minPrice) {
          whereClause.pricing.salePrice = { gte: Number(minPrice) };
        }
        if (maxPrice) {
          whereClause.pricing.salePrice = { ...whereClause.pricing.salePrice, lte: Number(maxPrice) };
        }
      }

      const skip = (Number(page) - 1) * Number(limit);

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where: whereClause,
          skip,
          take: Number(limit),
          orderBy: { [sortBy as string]: sortOrder as 'asc' | 'desc' },
          include: {
            category: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
            pricing: true,
            stock: true,
            images: {
              take: 3,
              orderBy: { order: 'asc' },
            },
          },
        }),
        prisma.product.count({ where: whereClause }),
      ]);

      const mobileProducts = products.map(product => ({
        id: product.id,
        name: product.name,
        slug: product.slug,
        sku: product.sku,
        description: product.description?.substring(0, 200),
        price: Number(product.pricing?.salePrice || 0),
        discountPrice: product.pricing?.discountPrice ? Number(product.pricing.discountPrice) : undefined,
        currency: product.pricing?.currency || 'TRY',
        stock: product.stock?.quantity || 0,
        images: product.images.map(img => img.url),
        category: product.category,
        rating: 4.5, // TODO: Implement rating system
        reviewCount: 0, // TODO: Implement review system
        isNew: product.createdAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        isOnSale: !!product.pricing?.discountPrice,
      }));

      res.json({
        success: true,
        data: {
          products: mobileProducts,
          pagination: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error) {
      logger.error('[Mobile] Error getting products', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get categories for mobile app
   */
  async getCategories(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.headers['x-tenant-id'] as string;
      
      if (!tenantId) {
        res.status(400).json({ error: 'Tenant ID required' });
        return;
      }

      const categories = await prisma.category.findMany({
        where: {
          tenantId,
          isActive: true,
          parentId: null, // Only root categories
        },
        select: {
          id: true,
          name: true,
          slug: true,
          image: true,
          _count: {
            select: {
              products: true,
              children: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      });

      const mobileCategories = categories.map(category => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        image: category.image,
        productCount: category._count.products,
        hasSubcategories: category._count.children > 0,
      }));

      res.json({
        success: true,
        data: mobileCategories,
      });
    } catch (error) {
      logger.error('[Mobile] Error getting categories', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get user profile
   */
  async getProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          avatar: true,
          createdAt: true,
          addresses: {
            where: { isActive: true },
            select: {
              id: true,
              title: true,
              firstName: true,
              lastName: true,
              address: true,
              city: true,
              country: true,
              postalCode: true,
              isDefault: true,
            },
          },
          orders: {
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              orderNumber: true,
              status: true,
              total: true,
              currency: true,
              createdAt: true,
            },
          },
        },
      });

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const profile = {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar,
        memberSince: user.createdAt,
        addresses: user.addresses,
        recentOrders: user.orders,
        stats: {
          totalOrders: user.orders.length,
          totalSpent: user.orders.reduce((sum, order) => sum + Number(order.total), 0),
        },
      };

      res.json({
        success: true,
        data: profile,
      });
    } catch (error) {
      logger.error('[Mobile] Error getting profile', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Create order
   */
  async createOrder(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const {
        items,
        shippingAddress,
        billingAddress,
        paymentMethod,
        notes,
      } = req.body;

      if (!items || items.length === 0) {
        res.status(400).json({ error: 'Items are required' });
        return;
      }

      // Validate products and calculate total
      const productIds = items.map((item: any) => item.productId);
      const products = await prisma.product.findMany({
        where: {
          id: { in: productIds },
          tenantId,
          isActive: true,
        },
        include: {
          pricing: true,
          stock: true,
        },
      });

      if (products.length !== productIds.length) {
        res.status(400).json({ error: 'Some products not found' });
        return;
      }

      let total = 0;
      const orderItems = [];

      for (const item of items) {
        const product = products.find(p => p.id === item.productId);
        if (!product) continue;

        const price = Number(product.pricing?.salePrice || 0);
        const quantity = item.quantity || 1;
        const itemTotal = price * quantity;
        
        total += itemTotal;

        orderItems.push({
          productId: product.id,
          quantity,
          price,
          total: itemTotal,
        });
      }

      // Generate order number
      const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

      // Create order
      const order = await prisma.order.create({
        data: {
          tenantId,
          customerId: userId,
          orderNumber,
          status: 'PENDING',
          currency: 'TRY',
          subtotal: total,
          tax: total * 0.18, // 18% KDV
          total: total * 1.18, // Including tax
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
                  slug: true,
                  images: {
                    take: 1,
                    orderBy: { order: 'asc' },
                  },
                },
              },
            },
          },
        },
      });

      logger.info('[Mobile] Order created', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId,
        total: order.total,
      });

      res.json({
        success: true,
        data: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          total: Number(order.total),
          currency: order.currency,
          items: order.items.map(item => ({
            id: item.id,
            quantity: item.quantity,
            price: Number(item.price),
            total: Number(item.total),
            product: {
              id: item.product.id,
              name: item.product.name,
              slug: item.product.slug,
              image: item.product.images[0]?.url,
            },
          })),
          createdAt: order.createdAt,
        },
      });
    } catch (error) {
      logger.error('[Mobile] Error creating order', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get orders
   */
  async getOrders(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;
      const { page = 1, limit = 20, status } = req.query;

      if (!userId || !tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const whereClause: any = {
        customerId: userId,
        tenantId,
      };

      if (status) {
        whereClause.status = status;
      }

      const skip = (Number(page) - 1) * Number(limit);

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where: whereClause,
          skip,
          take: Number(limit),
          orderBy: { createdAt: 'desc' },
          include: {
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    images: {
                      take: 1,
                      orderBy: { order: 'asc' },
                    },
                  },
                },
              },
            },
          },
        }),
        prisma.order.count({ where: whereClause }),
      ]);

      const mobileOrders = orders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: Number(order.total),
        currency: order.currency,
        itemCount: order.items.length,
        items: order.items.map(item => ({
          id: item.id,
          quantity: item.quantity,
          price: Number(item.price),
          total: Number(item.total),
          product: {
            id: item.product.id,
            name: item.product.name,
            slug: item.product.slug,
            image: item.product.images[0]?.url,
          },
        })),
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      }));

      res.json({
        success: true,
        data: {
          orders: mobileOrders,
          pagination: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error) {
      logger.error('[Mobile] Error getting orders', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get notifications
   */
  async getNotifications(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;
      const { page = 1, limit = 20, unreadOnly = false } = req.query;

      if (!userId || !tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const whereClause: any = {
        userId,
        tenantId,
      };

      if (unreadOnly === 'true') {
        whereClause.isRead = false;
      }

      const skip = (Number(page) - 1) * Number(limit);

      const [notifications, total] = await Promise.all([
        prisma.notification.findMany({
          where: whereClause,
          skip,
          take: Number(limit),
          orderBy: { createdAt: 'desc' },
        }),
        prisma.notification.count({ where: whereClause }),
      ]);

      const mobileNotifications = notifications.map(notification => ({
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        isRead: notification.isRead,
        data: notification.data,
        createdAt: notification.createdAt,
      }));

      res.json({
        success: true,
        data: {
          notifications: mobileNotifications,
          pagination: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error) {
      logger.error('[Mobile] Error getting notifications', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Mark notification as read
   */
  async markNotificationRead(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;
      const { notificationId } = req.body;

      if (!userId || !tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      await prisma.notification.update({
        where: {
          id: notificationId,
          userId,
          tenantId,
        },
        data: {
          isRead: true,
        },
      });

      res.json({
        success: true,
        message: 'Notification marked as read',
      });
    } catch (error) {
      logger.error('[Mobile] Error marking notification as read', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get wishlist
   */
  async getWishlist(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const wishlist = await prisma.wishlist.findMany({
        where: {
          userId,
          tenantId,
        },
        include: {
          product: {
            include: {
              pricing: true,
              stock: true,
              images: {
                take: 1,
                orderBy: { order: 'asc' },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const mobileWishlist = wishlist.map(item => ({
        id: item.id,
        product: {
          id: item.product.id,
          name: item.product.name,
          slug: item.product.slug,
          price: Number(item.product.pricing?.salePrice || 0),
          discountPrice: item.product.pricing?.discountPrice ? Number(item.product.pricing.discountPrice) : undefined,
          currency: item.product.pricing?.currency || 'TRY',
          stock: item.product.stock?.quantity || 0,
          image: item.product.images[0]?.url,
        },
        addedAt: item.createdAt,
      }));

      res.json({
        success: true,
        data: mobileWishlist,
      });
    } catch (error) {
      logger.error('[Mobile] Error getting wishlist', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Add to wishlist
   */
  async addToWishlist(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;
      const { productId } = req.body;

      if (!userId || !tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!productId) {
        res.status(400).json({ error: 'Product ID is required' });
        return;
      }

      // Check if already in wishlist
      const existing = await prisma.wishlist.findFirst({
        where: {
          userId,
          tenantId,
          productId,
        },
      });

      if (existing) {
        res.status(400).json({ error: 'Product already in wishlist' });
        return;
      }

      const wishlistItem = await prisma.wishlist.create({
        data: {
          userId,
          tenantId,
          productId,
        },
      });

      res.json({
        success: true,
        data: {
          id: wishlistItem.id,
        },
      });
    } catch (error) {
      logger.error('[Mobile] Error adding to wishlist', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Remove from wishlist
   */
  async removeFromWishlist(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;
      const { productId } = req.body;

      if (!userId || !tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!productId) {
        res.status(400).json({ error: 'Product ID is required' });
        return;
      }

      await prisma.wishlist.delete({
        where: {
          userId_productId: {
            userId,
            productId,
          },
        },
      });

      res.json({
        success: true,
        message: 'Product removed from wishlist',
      });
    } catch (error) {
      logger.error('[Mobile] Error removing from wishlist', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const mobileController = new MobileController();
