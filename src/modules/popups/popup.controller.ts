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

export class PopupController {
  /**
   * Get all popups (admin)
   */
  async getAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const popups = await prisma.popup.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: popups });
    } catch (error) {
      console.error('Error fetching popups:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get active popup for storefront
   */
  async getActive(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Get the first active popup
      const popup = await prisma.popup.findFirst({
        where: {
          tenantId,
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: popup });
    } catch (error) {
      console.error('Error fetching active popup:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get popup by ID
   */
  async getById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const popup = await prisma.popup.findFirst({
        where: {
          id,
          tenantId,
        },
      });

      if (!popup) {
        res.status(404).json({ error: 'Popup not found' });
        return;
      }

      res.json({ success: true, data: popup });
    } catch (error) {
      console.error('Error fetching popup:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Create popup
   */
  async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const {
        title,
        content,
        triggerType,
        triggerValue,
        isActive,
        buttonText,
        buttonLink,
        imageUrl,
        position,
      } = req.body;

      const popup = await prisma.popup.create({
        data: {
          title,
          content,
          triggerType: triggerType || 'time',
          triggerValue: triggerValue || 3000,
          isActive: isActive !== undefined ? isActive : true,
          buttonText,
          buttonLink,
          imageUrl,
          position: position || 'center',
          tenantId,
        },
      });

      res.status(201).json({ success: true, data: popup });
    } catch (error) {
      console.error('Error creating popup:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update popup
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
        title,
        content,
        triggerType,
        triggerValue,
        isActive,
        buttonText,
        buttonLink,
        imageUrl,
        position,
      } = req.body;

      const popup = await prisma.popup.updateMany({
        where: {
          id,
          tenantId,
        },
        data: {
          title,
          content,
          triggerType,
          triggerValue,
          isActive,
          buttonText,
          buttonLink,
          imageUrl,
          position,
        },
      });

      if (popup.count === 0) {
        res.status(404).json({ error: 'Popup not found' });
        return;
      }

      const updated = await prisma.popup.findUnique({ where: { id } });
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating popup:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Delete popup
   */
  async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const result = await prisma.popup.deleteMany({
        where: {
          id,
          tenantId,
        },
      });

      if (result.count === 0) {
        res.status(404).json({ error: 'Popup not found' });
        return;
      }

      res.json({ success: true, message: 'Popup deleted' });
    } catch (error) {
      console.error('Error deleting popup:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Toggle popup active status
   */
  async toggleActive(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const popup = await prisma.popup.findFirst({
        where: { id, tenantId },
      });

      if (!popup) {
        res.status(404).json({ error: 'Popup not found' });
        return;
      }

      const updated = await prisma.popup.update({
        where: { id },
        data: { isActive: !popup.isActive },
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error toggling popup:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const popupController = new PopupController();
