import prisma from '../../config/database';
import { AppError } from '../../common/middleware/error.middleware';
import { syncTenantDomainsFromTenant } from '../../services/tenantDomainSync.service';

interface CreateTenantDto {
  name: string;
  slug: string;
  domain?: string;
}

export class TenantService {
  async create(data: CreateTenantDto) {
    const existingTenant = await prisma.tenant.findUnique({
      where: { slug: data.slug },
    });

    if (existingTenant) {
      throw new AppError('Tenant with this slug already exists', 409);
    }

    const tenant = await prisma.tenant.create({
      data,
    });
    await syncTenantDomainsFromTenant({
      id:               tenant.id,
      subdomain:        tenant.subdomain,
      customDomain:     tenant.customDomain,
      domainVerified:   tenant.domainVerified,
    });
    return tenant;
  }

  async getAll() {
    return prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string) {
    return prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: true,
            products: true,
            orders: true,
          },
        },
      },
    });
  }
}
