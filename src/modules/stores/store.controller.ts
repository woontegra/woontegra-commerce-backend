import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

const prisma = new PrismaClient();

export class StoreController {
  /**
   * Get all stores
   */
  async getAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const stores = await prisma.store.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });

      res.json({ success: true, data: stores });
    } catch (error) {
      console.error('Error fetching stores:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get store by ID
   */
  async getById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const store = await prisma.store.findFirst({
        where: { id, tenantId },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });

      if (!store) {
        res.status(404).json({ error: 'Store not found' });
        return;
      }

      res.json({ success: true, data: store });
    } catch (error) {
      console.error('Error fetching store:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Create store
   */
  async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const {
        name,
        slug,
        description,
        email,
        phone,
        address,
        city,
        country,
        isActive,
        isDefault,
        logo,
        settings,
      } = req.body;

      // If this is set as default, unset other defaults
      if (isDefault) {
        await prisma.store.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const store = await prisma.store.create({
        data: {
          name,
          slug,
          description,
          email,
          phone,
          address,
          city,
          country: country || 'TR',
          isActive: isActive !== undefined ? isActive : true,
          isDefault: isDefault || false,
          logo,
          settings,
          tenantId,
        },
      });

      res.status(201).json({ success: true, data: store });
    } catch (error) {
      console.error('Error creating store:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update store
   */
  async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const {
        name,
        slug,
        description,
        email,
        phone,
        address,
        city,
        country,
        isActive,
        isDefault,
        logo,
        settings,
      } = req.body;

      // If this is set as default, unset other defaults
      if (isDefault) {
        await prisma.store.updateMany({
          where: { tenantId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      const result = await prisma.store.updateMany({
        where: { id, tenantId },
        data: {
          name,
          slug,
          description,
          email,
          phone,
          address,
          city,
          country,
          isActive,
          isDefault,
          logo,
          settings,
        },
      });

      if (result.count === 0) {
        res.status(404).json({ error: 'Store not found' });
        return;
      }

      const updated = await prisma.store.findUnique({ where: { id } });
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating store:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Delete store
   */
  async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Check if store has products
      const store = await prisma.store.findFirst({
        where: { id, tenantId },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });

      if (!store) {
        res.status(404).json({ error: 'Store not found' });
        return;
      }

      if (store._count.products > 0) {
        res.status(400).json({ 
          error: 'Cannot delete store with products',
          productCount: store._count.products,
        });
        return;
      }

      await prisma.store.delete({ where: { id } });

      res.json({ success: true, message: 'Store deleted' });
    } catch (error) {
      console.error('Error deleting store:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Toggle store active status
   */
  async toggleActive(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const store = await prisma.store.findFirst({
        where: { id, tenantId },
      });

      if (!store) {
        res.status(404).json({ error: 'Store not found' });
        return;
      }

      const updated = await prisma.store.update({
        where: { id },
        data: { isActive: !store.isActive },
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error toggling store:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Set store as default
   */
  async setDefault(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Unset all defaults
      await prisma.store.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });

      // Set this as default
      const updated = await prisma.store.update({
        where: { id },
        data: { isDefault: true },
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error setting default store:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get products by store
   */
  async getProducts(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const products = await prisma.product.findMany({
        where: { storeId: id, tenantId },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: products });
    } catch (error) {
      console.error('Error fetching store products:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const storeController = new StoreController();
