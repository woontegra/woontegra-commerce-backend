import prisma from '../../config/database';

export class CustomerService {
  async getAll(tenantId: string) {
    return prisma.customer.findMany({
      where: { tenantId },
      include: {
        orders: {
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string, tenantId: string) {
    return prisma.customer.findFirst({
      where: { id, tenantId },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async create(data: any, tenantId: string) {
    return prisma.customer.create({
      data: {
        ...data,
        tenant: {
          connect: { id: tenantId },
        },
      },
    });
  }

  async update(id: string, data: any, tenantId: string) {
    return prisma.customer.update({
      where: { id },
      data,
    });
  }

  async delete(id: string, tenantId: string) {
    return prisma.customer.delete({
      where: { id },
    });
  }
}
