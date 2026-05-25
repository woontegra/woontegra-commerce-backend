import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../../common/middleware/error.middleware';
import {
  checkProductLimit,
  invalidateTenantProductUsageCache,
  PLAN_LIMIT_EXCEEDED,
  PLAN_LIMIT_EXCEEDED_MESSAGE,
} from '../../services/planQuota.service';
import { generateToken } from '../../common/utils/jwt.util';
import { hashPassword } from '../../common/utils/password.util';
import { validateEmail, validateSubdomain } from '../../common/utils/validation.util';
import { syncTenantDomainsFromTenant } from '../../services/tenantDomainSync.service';
import { syncOnboardingCompletionForTenant } from '../../services/onboardingCompletion.service';

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

      await syncTenantDomainsFromTenant({
        id:               tenant.id,
        subdomain:        tenant.subdomain,
        customDomain:     tenant.customDomain,
        domainVerified:   tenant.domainVerified,
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

  // ─── NEW ONBOARDING WIZARD ENDPOINTS ─────────────────────────────────────────

  /**
   * STEP 1: Save theme selection
   * POST /api/onboarding/theme
   */
  async saveTheme(req: Request, res: Response): Promise<void> {
    try {
      const { userId, tenantId } = (req as any).user;
      const { themePreset } = req.body;

      if (!themePreset || !['modern', 'classic', 'minimal'].includes(themePreset)) {
        res.status(400).json({ success: false, message: 'Geçersiz tema seçimi' });
        return;
      }

      // Update tenant theme
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { themePreset }
      });

      // Update user onboarding step
      await prisma.user.update({
        where: { id: userId },
        data: { onboardingStep: 1 }
      });

      res.json({
        success: true,
        message: 'Tema kaydedildi',
        data: { themePreset }
      });
    } catch (error: any) {
      console.error('Save theme error:', error);
      res.status(500).json({ success: false, message: 'Tema kaydedilemedi', error: error.message });
    }
  }

  /**
   * STEP 2: Save store info
   * POST /api/onboarding/store-info
   */
  async saveStoreInfo(req: Request, res: Response): Promise<void> {
    try {
      const { userId, tenantId } = (req as any).user;
      const { name, description, logoUrl, phase } = req.body as {
        name: string;
        description?: string;
        logoUrl?: string;
        /** 'name' = adım 1 (sadece isim), 'logo' = adım 2 (logo + opsiyonel açıklama) */
        phase?: 'name' | 'logo';
      };

      if (!name || name.trim().length < 2) {
        res.status(400).json({ success: false, message: 'Mağaza adı zorunludur' });
        return;
      }

      const tenantPatch: Record<string, unknown> = { name: name.trim() };
      if (phase !== 'name') {
        tenantPatch.description = description?.trim() || null;
        tenantPatch.logoUrl = logoUrl?.trim() || null;
      }

      await prisma.tenant.update({
        where: { id: tenantId },
        data: tenantPatch as { name: string; description?: string | null; logoUrl?: string | null },
      });

      const nextStep = phase === 'logo' ? 2 : phase === 'name' ? 1 : 2;
      await prisma.user.update({
        where: { id: userId },
        data: { onboardingStep: nextStep },
      });

      res.json({
        success: true,
        message: 'Mağaza bilgileri kaydedildi',
        data: { name, description, logoUrl, onboardingStep: nextStep },
      });
    } catch (error: any) {
      console.error('Save store info error:', error);
      res.status(500).json({ success: false, message: 'Bilgiler kaydedilemedi', error: error.message });
    }
  }

  /**
   * STEP 3: Create first product
   * POST /api/onboarding/product
   */
  async createFirstProduct(req: Request, res: Response): Promise<void> {
    try {
      const { userId, tenantId } = (req as any).user;
      const { name, price, stock, imageUrl, description } = req.body;

      if (!name || !price || stock === undefined || stock === '') {
        res.status(400).json({ success: false, message: 'Ürün adı, fiyat ve stok zorunludur' });
        return;
      }

      const priceNum = typeof price === 'number' ? price : parseFloat(String(price));
      const stockNum = typeof stock === 'number' ? stock : parseInt(String(stock), 10);

      if (isNaN(priceNum) || priceNum <= 0) {
        res.status(400).json({ success: false, message: 'Geçersiz fiyat' });
        return;
      }

      if (isNaN(stockNum) || stockNum < 0) {
        res.status(400).json({ success: false, message: 'Geçersiz stok' });
        return;
      }

      const slugBase = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'urun';
      const slug = `${slugBase}-${Date.now().toString(36)}`;

      try {
        await checkProductLimit(tenantId, 1);
      } catch (e: unknown) {
        const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: string }).code) : '';
        if (code === PLAN_LIMIT_EXCEEDED) {
          res.status(403).json({
            success: false,
            error:   PLAN_LIMIT_EXCEEDED,
            message: PLAN_LIMIT_EXCEEDED_MESSAGE,
            code:    PLAN_LIMIT_EXCEEDED,
          });
          return;
        }
        throw e;
      }

      const product = await prisma.product.create({
        data: {
          name:        name.trim(),
          slug,
          description: typeof description === 'string' ? description.trim() || null : null,
          price:       priceNum,
          sku:         `ONB-${Date.now().toString(36)}`,
          images:      imageUrl ? [String(imageUrl)] : [],
          tenantId,
          isActive:    true,
        },
      });

      await prisma.stock.create({
        data: {
          productId: product.id,
          tenantId,
          quantity:  stockNum,
        },
      });

      void invalidateTenantProductUsageCache(tenantId).catch(() => {});

      await syncOnboardingCompletionForTenant(tenantId);

      res.json({
        success: true,
        message: 'İlk ürün oluşturuldu',
        data: product,
      });
    } catch (error: any) {
      console.error('Create first product error:', error);
      res.status(500).json({ success: false, message: 'Ürün oluşturulamadı', error: error.message });
    }
  }

  /**
   * STEP 4: Complete onboarding
   * POST /api/onboarding/complete
   */
  async completeOnboardingWizard(req: Request, res: Response): Promise<void> {
    try {
      const { userId, tenantId } = (req as any).user;

      // Mark onboarding as completed
      await prisma.user.update({
        where: { id: userId },
        data: {
          onboardingCompleted: true,
          onboardingStep: 4
        }
      });

      // Get updated tenant info
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true, subdomain: true, themePreset: true, logoUrl: true }
      });

      res.json({
        success: true,
        message: 'Onboarding tamamlandı',
        data: {
          completed: true,
          tenant
        }
      });
    } catch (error: any) {
      console.error('Complete onboarding error:', error);
      res.status(500).json({ success: false, message: 'Onboarding tamamlanamadı', error: error.message });
    }
  }

  /**
   * Get current onboarding status
   * GET /api/onboarding/status
   */
  async getOnboardingWizardStatus(req: Request, res: Response): Promise<void> {
    try {
      const { userId, tenantId } = (req as any).user;

      let user = await prisma.user.findUnique({
        where: { id: userId },
        select: { onboardingCompleted: true, onboardingStep: true },
      });

      let productCount = await prisma.product.count({ where: { tenantId } });

      if (!user?.onboardingCompleted && productCount >= 1) {
        await syncOnboardingCompletionForTenant(tenantId);
        user = await prisma.user.findUnique({
          where: { id: userId },
          select: { onboardingCompleted: true, onboardingStep: true },
        });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { themePreset: true, name: true, logoUrl: true, description: true },
      });

      res.json({
        success: true,
        data: {
          onboardingCompleted: user?.onboardingCompleted || false,
          currentStep: user?.onboardingStep || 0,
          themePreset: tenant?.themePreset || 'modern',
          storeName: tenant?.name,
          logoUrl: tenant?.logoUrl,
          description: tenant?.description,
          hasProducts: productCount > 0,
        },
      });
    } catch (error: any) {
      console.error('Get onboarding status error:', error);
      res.status(500).json({ success: false, message: 'Durum alınamadı' });
    }
  }

  /** POST /api/onboarding/dismiss — panele geç, ürün zorunlu değil */
  async dismissOnboarding(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = (req as any).user;
      await prisma.user.update({
        where: { id: userId },
        data: {
          onboardingCompleted: true,
          onboardingStep:      4,
        },
      });
      res.json({ success: true, message: 'Onboarding atlandı', data: { onboardingCompleted: true } });
    } catch (error: any) {
      console.error('Dismiss onboarding error:', error);
      res.status(500).json({ success: false, message: 'İşlem başarısız', error: error.message });
    }
  }

  /** POST /api/onboarding/reopen — kurulum ekranına dönmek için (isteğe bağlı) */
  async reopenOnboarding(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = (req as any).user;
      await prisma.user.update({
        where: { id: userId },
        data: {
          onboardingCompleted: false,
          onboardingStep:      0,
        },
      });
      res.json({ success: true, message: 'Kurulum yeniden açıldı', data: { onboardingCompleted: false } });
    } catch (error: any) {
      console.error('Reopen onboarding error:', error);
      res.status(500).json({ success: false, message: 'İşlem başarısız', error: error.message });
    }
  }
}
