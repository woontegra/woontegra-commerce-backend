import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export class AbandonedCartService {
  /**
   * Find carts that have been abandoned (no activity for 1 hour)
   */
  async findAbandonedCarts(): Promise<any[]> {
    try {
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);

      // Find carts that:
      // 1. Have items
      // 2. Haven't been updated in the last hour
      // 3. Don't have an associated order
      // 4. Haven't been marked as abandoned yet (or were marked more than 24 hours ago)
      const abandonedCarts = await prisma.cart.findMany({
        where: {
          updatedAt: {
            lt: oneHourAgo,
          },
          items: {
            some: {}, // Has at least one item
          },
          // No order associated with this cart
          NOT: {
            Order: {
              some: {},
            },
          },
          // Either never marked as abandoned, or marked more than 24 hours ago
          OR: [
            {
              AbandonedCart: null,
            },
            {
              AbandonedCart: {
                emailSentAt: {
                  lt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
                },
              },
            },
          ],
        },
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
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  price: true,
                  images: true,
                },
              },
              variant: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  images: true,
                },
              },
            },
          },
          tenant: {
            select: {
              id: true,
              name: true,
              settings: {
                select: {
                  contactEmail: true,
                },
              },
            },
          },
        },
      });

      logger.info('[AbandonedCart] Found abandoned carts', {
        count: abandonedCarts.length,
      });

      return abandonedCarts;
    } catch (error) {
      logger.error('[AbandonedCart] Error finding abandoned carts', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Mark cart as abandoned and record email sent
   */
  async markAsAbandoned(cartId: string): Promise<void> {
    try {
      await prisma.abandonedCart.upsert({
        where: { cartId },
        create: {
          cartId,
          emailSentAt: new Date(),
        },
        update: {
          emailSentAt: new Date(),
        },
      });

      logger.info('[AbandonedCart] Marked cart as abandoned', { cartId });
    } catch (error) {
      logger.error('[AbandonedCart] Error marking cart as abandoned', {
        cartId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Calculate cart total
   */
  calculateCartTotal(cart: any): number {
    return cart.items.reduce((total: number, item: any) => {
      const price = item.variant?.price || item.product?.price || 0;
      return total + price * item.quantity;
    }, 0);
  }

  /**
   * Get cart recovery URL
   */
  getCartRecoveryUrl(cartId: string): string {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return `${frontendUrl}/cart?recover=${cartId}`;
  }
}

export const abandonedCartService = new AbandonedCartService();
