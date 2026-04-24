import { PrismaClient } from '@prisma/client';

export class WishlistService {
  constructor(private prisma: PrismaClient) {}

  async getOrCreateWishlist(userId: string, tenantId: string) {
    let wishlist = await this.prisma.wishlist.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                price: true,
                images: true,
                isActive: true,
                stock: true,
              },
            },
            variant: {
              select: {
                id: true,
                name: true,
                price: true,
                images: true,
                stockQuantity: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (!wishlist) {
      wishlist = await this.prisma.wishlist.create({
        data: {
          userId,
          tenantId,
        },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  price: true,
                  images: true,
                  isActive: true,
                  stock: true,
                },
              },
              variant: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  images: true,
                  stockQuantity: true,
                  isActive: true,
                },
              },
            },
          },
        },
      });
    }

    return wishlist;
  }

  async addItem(userId: string, tenantId: string, productId: string, variantId?: string) {
    const wishlist = await this.getOrCreateWishlist(userId, tenantId);

    // Check if item already exists
    const existingItem = await this.prisma.wishlistItem.findUnique({
      where: {
        wishlistId_productId_variantId: {
          wishlistId: wishlist.id,
          productId,
          variantId: variantId || null,
        },
      },
    });

    if (existingItem) {
      return existingItem;
    }

    // Add new item
    return this.prisma.wishlistItem.create({
      data: {
        wishlistId: wishlist.id,
        productId,
        variantId: variantId || null,
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            price: true,
            images: true,
            isActive: true,
            stock: true,
          },
        },
        variant: {
          select: {
            id: true,
            name: true,
            price: true,
            images: true,
            stockQuantity: true,
            isActive: true,
          },
        },
      },
    });
  }

  async removeItem(userId: string, tenantId: string, productId: string, variantId?: string) {
    const wishlist = await this.getOrCreateWishlist(userId, tenantId);

    await this.prisma.wishlistItem.deleteMany({
      where: {
        wishlistId: wishlist.id,
        productId,
        variantId: variantId || null,
      },
    });
  }

  async clearWishlist(userId: string, tenantId: string) {
    const wishlist = await this.getOrCreateWishlist(userId, tenantId);

    await this.prisma.wishlistItem.deleteMany({
      where: {
        wishlistId: wishlist.id,
      },
    });
  }

  async isInWishlist(userId: string, tenantId: string, productId: string, variantId?: string): Promise<boolean> {
    const wishlist = await this.prisma.wishlist.findUnique({
      where: { userId },
    });

    if (!wishlist) {
      return false;
    }

    const item = await this.prisma.wishlistItem.findUnique({
      where: {
        wishlistId_productId_variantId: {
          wishlistId: wishlist.id,
          productId,
          variantId: variantId || null,
        },
      },
    });

    return !!item;
  }

  async getWishlistCount(userId: string): Promise<number> {
    const wishlist = await this.prisma.wishlist.findUnique({
      where: { userId },
      include: {
        _count: {
          select: { items: true },
        },
      },
    });

    return wishlist?._count.items || 0;
  }
}
