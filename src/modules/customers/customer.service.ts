import { Prisma } from '@prisma/client';
import prisma from '../../config/database';

export interface CreateCustomerDto {
  firstName: string;
  lastName:  string;
  email:     string;
  phone?:    string;
  address?:  string;
  city?:     string;
  country?:  string;
  zipCode?:  string;
}

export interface GetCustomersQuery {
  page?:   number;
  limit?:  number;
  search?: string;
}

export class CustomerService {
  async getAll(tenantId: string, query: GetCustomersQuery = {}) {
    const { page = 1, limit = 20, search } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Prisma.CustomerWhereInput = { tenantId };

    if (search?.trim()) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
        { email:     { contains: search, mode: 'insensitive' } },
        { phone:     { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, rawCustomers] = await prisma.$transaction([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        include: {
          _count:  { select: { orders: true } },
          orders:  { select: { totalAmount: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
    ]);

    const customers = rawCustomers.map(({ orders, _count, ...c }) => ({
      ...c,
      orderCount:  _count.orders,
      totalSpent:  orders.reduce((sum, o) => sum + Number(o.totalAmount), 0),
    }));

    return {
      customers,
      total,
      page:       Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    };
  }

  async getById(id: string, tenantId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id, tenantId },
      include: {
        _count:  { select: { orders: true } },
        orders: {
          include: {
            items: {
              include: { product: { select: { id: true, name: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!customer) return null;

    const { orders, _count, ...rest } = customer;
    return {
      ...rest,
      orderCount: _count.orders,
      totalSpent: orders.reduce((sum, o) => sum + Number(o.totalAmount), 0),
      recentOrders: orders,
    };
  }

  async create(data: CreateCustomerDto, tenantId: string) {
    const existing = await prisma.customer.findFirst({
      where: { email: data.email, tenantId },
    });
    if (existing) {
      throw new Error(`Bu e-posta adresi zaten kayıtlı: ${data.email}`);
    }

    return prisma.customer.create({
      data: {
        ...data,
        tenant: { connect: { id: tenantId } },
      },
    });
  }

  async update(id: string, data: Partial<CreateCustomerDto>, tenantId: string) {
    const existing = await prisma.customer.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Müşteri bulunamadı.');

    if (data.email && data.email !== existing.email) {
      const conflict = await prisma.customer.findFirst({
        where: { email: data.email, tenantId, NOT: { id } },
      });
      if (conflict) throw new Error(`Bu e-posta adresi başka bir müşteriye ait: ${data.email}`);
    }

    return prisma.customer.update({ where: { id }, data });
  }

  async delete(id: string, tenantId: string) {
    const existing = await prisma.customer.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error('Müşteri bulunamadı.');
    return prisma.customer.delete({ where: { id } });
  }

  async getStats(tenantId: string) {
    const now       = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total, newThisMonth] = await prisma.$transaction([
      prisma.customer.count({ where: { tenantId } }),
      prisma.customer.count({ where: { tenantId, createdAt: { gte: monthStart } } }),
    ]);

    return { total, newThisMonth };
  }
}
