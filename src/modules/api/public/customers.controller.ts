import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiRequest } from '../../../middleware/apiAuth';

const prisma = new PrismaClient();

export class PublicCustomersController {
  /** GET /api/v1/customers */
  async list(req: ApiRequest, res: Response) {
    const tenantId = req.apiToken!.tenantId;
    const page  = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(100, parseInt(req.query.limit as string || '20'));
    const search = req.query.search as string | undefined;

    const where: any = { tenantId, ...(search && {
      OR: [
        { email:     { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
      ],
    })};

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where, skip: (page - 1) * limit, take: limit,
        select: { id: true, email: true, firstName: true, lastName: true, phone: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customer.count({ where }),
    ]);

    return res.json({ success: true, data: customers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  }

  /** GET /api/v1/customers/:id */
  async getById(req: ApiRequest, res: Response) {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, tenantId: req.apiToken!.tenantId },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, createdAt: true },
    });
    if (!customer) return res.status(404).json({ success: false, message: 'Müşteri bulunamadı.' });
    return res.json({ success: true, data: customer });
  }

  /** POST /api/v1/customers */
  async create(req: ApiRequest, res: Response) {
    const { email, firstName, lastName, phone } = req.body;
    if (!email || !firstName || !lastName) {
      return res.status(400).json({ success: false, message: 'email, firstName, lastName zorunlu.' });
    }
    const existing = await prisma.customer.findFirst({ where: { email, tenantId: req.apiToken!.tenantId } });
    if (existing) return res.status(409).json({ success: false, message: 'Bu e-posta zaten kayıtlı.' });

    const customer = await prisma.customer.create({
      data: { tenantId: req.apiToken!.tenantId, email, firstName, lastName, phone },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, createdAt: true },
    });
    return res.status(201).json({ success: true, data: customer });
  }
}
