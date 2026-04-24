import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../../common/middleware/error.middleware';
import { generateToken } from '../../common/utils/jwt.util';
import { hashPassword } from '../../common/utils/password.util';
import { validateEmail, validateSubdomain } from '../../common/utils/validation.util';

const prisma = new PrismaClient();

interface RegisterTenantDto {
  name: string;
  subdomain: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

interface RegisterUserDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  tenantId: string;
}

interface CompleteOnboardingDto {
  storeName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  customDomain?: string;
  plan?: 'STARTER' | 'PRO' | 'ADVANCED';
}

export class OnboardingController {
  async registerTenant(req: Request, res: Response): Promise<void> {
    try {
      const { name, subdomain, email, password, firstName, lastName }: RegisterTenantDto = req.body;

      // Validation
      if (!name || !subdomain || !email || !password || !firstName || !lastName) {
        throw new AppError('All fields are required', 400);
      }

      if (!validateEmail(email)) {
        throw new AppError('Invalid email format', 400);
      }

      if (!validateSubdomain(subdomain)) {
        throw new AppError('Invalid subdomain format', 400);
      }

      // Check if tenant already exists
      const existingTenant = await prisma.tenant.findFirst({
        where: {
          OR: [
            { slug: subdomain.toLowerCase() },
            { subdomain: subdomain.toLowerCase() },
            { customDomain: subdomain.toLowerCase() }
          ]
        }
      });

      if (existingTenant) {
        throw new AppError('Tenant already exists', 409);
      }

      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: {
          email: email.toLowerCase()
        }
      });

      if (existingUser) {
        throw new AppError('Email already registered', 409);
      }

      // Create tenant
      const tenant = await prisma.tenant.create({
        data: {
          name,
          slug: subdomain.toLowerCase(),
          subdomain: subdomain.toLowerCase(),
          isActive: true
        }
      });

      // Create user (owner)
      const hashedPassword = await hashPassword(password);
      const user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          password: hashedPassword,
          firstName,
          lastName,
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
          firstName,
          lastName,
          email
        }
      });

      // Generate JWT token
      const token = generateToken({
        userId: user.id,
        tenantId: tenant.id,
        role: 'ADMIN'
      });

      res.status(201).json({
        status: 'success',
        data: {
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
          },
          onboardingStep: 1
        }
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Registration failed' });
      }
    }
  }

  async getOnboardingStatus(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId } = (req as any).user;
      const onboarding = await prisma.onboarding.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' }
      });

      res.json({
        status: 'success',
        data: {
          step: onboarding?.step || 1,
          completed: onboarding?.completed || false,
          storeName: onboarding?.storeName,
          firstName: onboarding?.firstName,
          lastName: onboarding?.lastName,
          email: onboarding?.email,
          subdomain: onboarding?.subdomain,
          customDomain: onboarding?.customDomain,
          plan: onboarding?.plan
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get onboarding status' });
    }
  }

  async updateOnboardingStep(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId } = (req as any).user;
      const { step, storeName, firstName, lastName, email, subdomain, customDomain, plan } = req.body;

      const currentOnboarding = await prisma.onboarding.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' }
      });

      if (!currentOnboarding) {
        // Create new onboarding record
        await prisma.onboarding.create({
          data: {
            tenantId,
            step,
            storeName,
            firstName,
            lastName,
            email,
            subdomain,
            customDomain,
            plan
          }
        });
      } else {
        // Update existing onboarding record
        await prisma.onboarding.update({
          where: { id: currentOnboarding.id },
          data: {
            step,
            storeName,
            firstName,
            lastName,
            email,
            subdomain,
            customDomain,
            plan
          }
        });
      }

      res.json({
        status: 'success',
        data: { step }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update onboarding step' });
    }
  }

  async completeOnboarding(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId } = (req as any).user;
      const { storeName, firstName, lastName, email, customDomain, plan } = req.body;

      // Update tenant with custom domain if provided
      if (customDomain) {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            customDomain,
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
          storeName,
          firstName,
          lastName,
          email,
          plan
        }
      });

      // Update user plan if provided
      if (plan) {
        await prisma.user.updateMany({
          where: { tenantId, role: 'ADMIN' },
          data: { plan }
        });
      }

      res.json({
        status: 'success',
        data: { completed: true }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to complete onboarding' });
    }
  }

  async registerUser(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, firstName, lastName, tenantId }: RegisterUserDto = req.body;

      // Validation
      if (!email || !password || !firstName || !lastName || !tenantId) {
        throw new AppError('All fields are required', 400);
      }

      if (!validateEmail(email)) {
        throw new AppError('Invalid email format', 400);
      }

      // Check if user exists in this tenant
      const existingUser = await prisma.user.findFirst({
        where: {
          email_tenantId: {
            email: email.toLowerCase(),
            tenantId
          }
        }
      });

      if (existingUser) {
        throw new AppError('User already exists in this tenant', 409);
      }

      // Create user
      const hashedPassword = await hashPassword(password);
      const user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          password: hashedPassword,
          firstName,
          lastName,
          role: 'USER',
          tenantId,
          plan: 'STARTER'
        }
      });

      // Generate JWT token
      const token = generateToken({
        userId: user.id,
        tenantId,
        role: 'USER'
      });

      res.status(201).json({
        status: 'success',
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            plan: user.plan
          }
        }
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Registration failed' });
      }
    }
  }
}
