import prisma from '../../config/database';

export class CategoryService {
  async getAll(tenantId: string) {
    return prisma.category.findMany({
      where: { tenantId },
      include: {
        parent: true,
        children: true,
        _count: {
          select: { products: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string, tenantId: string) {
    return prisma.category.findFirst({
      where: { id, tenantId },
      include: {
        parent: true,
        children: true,
        products: true,
      },
    });
  }

  async create(data: any, tenantId: string) {
    return prisma.category.create({
      data: {
        ...data,
        tenant: {
          connect: { id: tenantId },
        },
      },
      include: {
        parent: true,
        children: true,
      },
    });
  }

  async update(id: string, data: any, tenantId: string) {
    return prisma.category.update({
      where: { id },
      data,
      include: {
        parent: true,
        children: true,
      },
    });
  }

  async delete(id: string, tenantId: string) {
    return prisma.category.delete({
      where: { id },
    });
  }

  async getProductsByCategory(categoryId: string, tenantId: string) {
    return prisma.product.findMany({
      where: {
        categoryId,
        tenantId,
      },
      include: {
        category: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
