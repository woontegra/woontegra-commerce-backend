import prisma from '../../config/database';
import { Prisma } from '@prisma/client';

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

  async create(data: Prisma.ProductCreateInput, tenantId: string) {
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

  async update(id: string, data: Prisma.ProductUpdateInput, tenantId: string) {
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
