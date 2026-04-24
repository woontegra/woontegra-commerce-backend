import { Request, Response } from 'express';
import { WishlistService } from './wishlist.service';
import { AuthenticatedRequest } from '../auth/auth.types';

export class WishlistController {
  constructor(private wishlistService: WishlistService) {}

  async getWishlist(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const wishlist = await this.wishlistService.getOrCreateWishlist(userId, tenantId);
      res.json(wishlist);
    } catch (error) {
      console.error('Error getting wishlist:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async addToWishlist(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;
      const { productId, variantId } = req.body;

      if (!userId || !tenantId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!productId) {
        return res.status(400).json({ error: 'Product ID is required' });
      }

      const item = await this.wishlistService.addItem(userId, tenantId, productId, variantId);
      res.status(201).json(item);
    } catch (error) {
      console.error('Error adding to wishlist:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async removeFromWishlist(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;
      const { productId, variantId } = req.body;

      if (!userId || !tenantId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!productId) {
        return res.status(400).json({ error: 'Product ID is required' });
      }

      await this.wishlistService.removeItem(userId, tenantId, productId, variantId);
      res.status(204).send();
    } catch (error) {
      console.error('Error removing from wishlist:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async clearWishlist(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      await this.wishlistService.clearWishlist(userId, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error('Error clearing wishlist:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async checkInWishlist(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const tenantId = req.user?.tenantId;
      const { productId, variantId } = req.query;

      if (!userId || !tenantId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!productId) {
        return res.status(400).json({ error: 'Product ID is required' });
      }

      const inWishlist = await this.wishlistService.isInWishlist(
        userId,
        tenantId,
        productId as string,
        variantId as string | undefined
      );

      res.json({ inWishlist });
    } catch (error) {
      console.error('Error checking wishlist:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
