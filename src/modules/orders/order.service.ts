import prisma from '../../config/database';

export class OrderService {
  async getAll(tenantId: string) {
    return prisma.order.findMany({
      where: { tenantId },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string, tenantId: string) {
    return prisma.order.findFirst({
      where: { id, tenantId },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });
  }

  async create(data: any, tenantId: string) {
    const { customerId, items, notes } = data;

    const totalAmount = items.reduce(
      (sum: number, item: any) => sum + item.price * item.quantity,
      0
    );

    const orderNumber = `ORD-${Date.now()}`;

    return prisma.order.create({
      data: {
        orderNumber,
        totalAmount,
        notes,
        status: 'PENDING',
        tenant: {
          connect: { id: tenantId },
        },
        customer: {
          connect: { id: customerId },
        },
        items: {
          create: items.map((item: any) => ({
            quantity: item.quantity,
            price: item.price,
            product: {
              connect: { id: item.productId },
            },
          })),
        },
      },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });
  }

  async updateStatus(id: string, status: string, tenantId: string) {
    return prisma.order.update({
      where: { id },
      data: { status: status as any },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });
  }

  async delete(id: string, tenantId: string) {
    return prisma.order.delete({
      where: { id },
    });
  }

  async getByCustomer(customerId: string, tenantId: string) {
    return prisma.order.findMany({
      where: {
        customerId,
        tenantId,
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
