import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { shippingRuleEngine } from '../../services/shipping-rule.engine';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

const prisma = new PrismaClient();

export class ShippingRuleController {
  /**
   * Get all shipping rules
   */
  async getAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const rules = await prisma.shippingRule.findMany({
        where: { tenantId },
        orderBy: { priority: 'desc' },
      });

      res.json({ success: true, data: rules });
    } catch (error) {
      console.error('Error fetching shipping rules:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get shipping rule by ID
   */
  async getById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const rule = await prisma.shippingRule.findFirst({
        where: { id, tenantId },
      });

      if (!rule) {
        res.status(404).json({ error: 'Shipping rule not found' });
        return;
      }

      res.json({ success: true, data: rule });
    } catch (error) {
      console.error('Error fetching shipping rule:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Create shipping rule
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
        description,
        isActive,
        priority,
        minOrderAmount,
        maxOrderAmount,
        cities,
        excludedCities,
        shippingCost,
        freeShippingThreshold,
        calculationType,
        percentageRate,
        weightRanges,
      } = req.body;

      const rule = await prisma.shippingRule.create({
        data: {
          name,
          description,
          isActive: isActive !== undefined ? isActive : true,
          priority: priority || 0,
          minOrderAmount,
          maxOrderAmount,
          cities: cities || [],
          excludedCities: excludedCities || [],
          shippingCost,
          freeShippingThreshold,
          calculationType: calculationType || 'fixed',
          percentageRate,
          weightRanges,
          tenantId,
        },
      });

      res.status(201).json({ success: true, data: rule });
    } catch (error) {
      console.error('Error creating shipping rule:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update shipping rule
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
        description,
        isActive,
        priority,
        minOrderAmount,
        maxOrderAmount,
        cities,
        excludedCities,
        shippingCost,
        freeShippingThreshold,
        calculationType,
        percentageRate,
        weightRanges,
      } = req.body;

      const result = await prisma.shippingRule.updateMany({
        where: { id, tenantId },
        data: {
          name,
          description,
          isActive,
          priority,
          minOrderAmount,
          maxOrderAmount,
          cities,
          excludedCities,
          shippingCost,
          freeShippingThreshold,
          calculationType,
          percentageRate,
          weightRanges,
        },
      });

      if (result.count === 0) {
        res.status(404).json({ error: 'Shipping rule not found' });
        return;
      }

      const updated = await prisma.shippingRule.findUnique({ where: { id } });
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating shipping rule:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Delete shipping rule
   */
  async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const result = await prisma.shippingRule.deleteMany({
        where: { id, tenantId },
      });

      if (result.count === 0) {
        res.status(404).json({ error: 'Shipping rule not found' });
        return;
      }

      res.json({ success: true, message: 'Shipping rule deleted' });
    } catch (error) {
      console.error('Error deleting shipping rule:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Calculate shipping cost
   */
  async calculate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { orderAmount, city, weight } = req.body;

      if (!orderAmount || !city) {
        res.status(400).json({ error: 'orderAmount and city are required' });
        return;
      }

      const result = await shippingRuleEngine.calculateShipping({
        tenantId,
        orderAmount: Number(orderAmount),
        city,
        weight: weight ? Number(weight) : undefined,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error calculating shipping:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Toggle shipping rule active status
   */
  async toggleActive(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const rule = await prisma.shippingRule.findFirst({
        where: { id, tenantId },
      });

      if (!rule) {
        res.status(404).json({ error: 'Shipping rule not found' });
        return;
      }

      const updated = await prisma.shippingRule.update({
        where: { id },
        data: { isActive: !rule.isActive },
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error toggling shipping rule:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const shippingRuleController = new ShippingRuleController();
