import { PrismaClient } from '@prisma/client';
import { AppError } from '../../common/middleware/error.middleware';
import { hashPassword, comparePassword } from '../../common/utils/password.util';
import { generateToken } from '../../common/utils/jwt.util';

const prisma = new PrismaClient();

export class OnboardingService {
  async createTenant(data: {
    name: string;
    subdomain: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) {
    // Check if tenant already exists
    const existingTenant = await prisma.tenant.findFirst({
      where: {
        OR: [
          { slug: data.subdomain.toLowerCase() },
          { subdomain: data.subdomain.toLowerCase() },
          { customDomain: data.subdomain.toLowerCase() }
        ]
      }
    });

    if (existingTenant) {
      throw new AppError('Tenant already exists', 409);
    }

    // Create tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: data.name,
        slug: data.subdomain.toLowerCase(),
        subdomain: data.subdomain.toLowerCase(),
        isActive: true
      }
    });

    // Create user (owner)
    const hashedPassword = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        password: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        role: 'ADMIN',
        tenantId: tenant.id,
        plan: 'STARTER'
      }
    });

    // Create onboarding record
    await prisma.onboarding.create({
      data: {
        tenantId: tenant.id,
        step: 1,
        completed: false,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email
      }
    });

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      tenantId: tenant.id,
      role: 'ADMIN'
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        plan: user.plan
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        subdomain: tenant.subdomain
      }
    };
  }

  async createUser(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    tenantId: string;
  }) {
    // Check if user exists in this tenant
    const existingUser = await prisma.user.findFirst({
      where: {
        email_tenantId: {
          email: data.email.toLowerCase(),
          tenantId: data.tenantId
        }
      }
    });

    if (existingUser) {
      throw new AppError('User already exists in this tenant', 409);
    }

    // Create user
    const hashedPassword = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        password: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        role: 'USER',
        tenantId: data.tenantId,
        plan: 'STARTER'
      }
    });

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      tenantId: data.tenantId,
      role: 'USER'
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        plan: user.plan
      }
    };
  }

  async getOnboardingStatus(tenantId: string) {
    const onboarding = await prisma.onboarding.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' }
    });

    return {
      step: onboarding?.step || 1,
      completed: onboarding?.completed || false,
      storeName: onboarding?.storeName,
      firstName: onboarding?.firstName,
      lastName: onboarding?.lastName,
      email: onboarding?.email,
      subdomain: onboarding?.subdomain,
      customDomain: onboarding?.customDomain,
      plan: onboarding?.plan
    };
  }

  async updateOnboardingStep(tenantId: string, data: {
    step: number;
    storeName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    subdomain?: string;
    customDomain?: string;
    plan?: 'STARTER' | 'PRO' | 'ADVANCED';
  }) {
    const currentOnboarding = await prisma.onboarding.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' }
    });

    if (!currentOnboarding) {
      // Create new onboarding record
      return await prisma.onboarding.create({
        data: {
          tenantId,
          ...data
        }
      });
    } else {
      // Update existing onboarding record
      return await prisma.onboarding.update({
        where: { id: currentOnboarding.id },
        data
      });
    }
  }

  async completeOnboarding(tenantId: string, data: {
    storeName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    customDomain?: string;
    plan?: 'STARTER' | 'PRO' | 'ADVANCED';
  }) {
    // Update tenant with custom domain if provided
    if (data.customDomain) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          customDomain: data.customDomain,
          domainVerified: false // Will be verified later
        }
      });
    }

    // Complete onboarding
    await prisma.onboarding.updateMany({
      where: { tenantId },
      data: {
        completed: true,
        step: 4,
        ...data
      }
    });

    // Update user plan if provided
    if (data.plan) {
      await prisma.user.updateMany({
        where: { tenantId, role: 'ADMIN' },
        data: { plan: data.plan }
      });
    }

    return { completed: true };
  }
}
