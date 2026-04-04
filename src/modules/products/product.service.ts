import prisma from '../../config/database';

export class ProductService {
  async getAll(tenantId: string) {
    return prisma.product.findMany({
      where: { tenantId },
      include: {
        category: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string, tenantId: string) {
    return prisma.product.findFirst({
      where: { id, tenantId },
      include: {
        category: true,
      },
    });
  }

  async create(data: any, tenantId: string) {
    return prisma.product.create({
      data: {
        ...data,
        tenant: {
          connect: { id: tenantId },
        },
      },
      include: {
        category: true,
      },
    });
  }

  async update(id: string, data: any, tenantId: string) {
    return prisma.product.update({
      where: { id },
      data: {
        ...data,
        tenant: {
          connect: { id: tenantId },
        },
      },
      include: {
        category: true,
      },
    });
  }

  async delete(id: string, tenantId: string) {
    return prisma.product.delete({
      where: { id },
    });
  }
}
