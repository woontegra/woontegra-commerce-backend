import prisma from '../../config/database';
import { hashPassword, comparePassword } from '../../common/utils/password.util';
import { generateStoreCustomerToken } from '../../common/utils/store-customer-jwt.util';
import type { StoreTenantPublic } from './store-tenant.util';

function customerPublic(row: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}) {
  return {
    id:        row.id,
    email:     row.email,
    firstName: row.firstName,
    lastName:  row.lastName,
    phone:     row.phone ?? '',
  };
}

export class StoreCustomerAuthService {
  async register(tenant: StoreTenantPublic, body: {
    firstName: string;
    lastName:  string;
    email:     string;
    phone:     string;
    password:  string;
  }) {
    const email = body.email.trim().toLowerCase();

    const existing = await prisma.customer.findUnique({
      where: { email_tenantId: { email, tenantId: tenant.id } },
    });

    if (existing?.passwordHash) {
      throw new Error('Bu e-posta adresi zaten kayıtlı.');
    }

    const passwordHash = await hashPassword(body.password);

    const customer = existing
      ? await prisma.customer.update({
          where: { id: existing.id },
          data: {
            firstName:    body.firstName.trim(),
            lastName:     body.lastName.trim(),
            phone:        body.phone.trim() || null,
            passwordHash,
          },
        })
      : await prisma.customer.create({
          data: {
            tenantId:     tenant.id,
            email,
            firstName:    body.firstName.trim(),
            lastName:     body.lastName.trim(),
            phone:        body.phone.trim() || null,
            passwordHash,
            country:      'TR',
          },
        });

    const token = generateStoreCustomerToken({
      customerId: customer.id,
      tenantId:   tenant.id,
      email:      customer.email,
    });

    return { customer: customerPublic(customer), token };
  }

  async login(tenant: StoreTenantPublic, emailRaw: string, password: string) {
    const email = emailRaw.trim().toLowerCase();

    const customer = await prisma.customer.findUnique({
      where: { email_tenantId: { email, tenantId: tenant.id } },
    });

    if (!customer?.passwordHash) {
      throw new Error('E-posta veya şifre hatalı.');
    }

    const ok = await comparePassword(password, customer.passwordHash);
    if (!ok) {
      throw new Error('E-posta veya şifre hatalı.');
    }

    const token = generateStoreCustomerToken({
      customerId: customer.id,
      tenantId:   tenant.id,
      email:      customer.email,
    });

    return { customer: customerPublic(customer), token };
  }

  async me(tenantId: string, customerId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        createdAt: true,
      },
    });
    if (!customer) {
      throw new Error('Müşteri bulunamadı.');
    }
    return customerPublic(customer);
  }
}

export const storeCustomerAuthService = new StoreCustomerAuthService();
