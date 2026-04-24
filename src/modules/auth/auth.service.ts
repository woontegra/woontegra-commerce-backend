import prisma from '../../config/database';
import { hashPassword, comparePassword } from '../../common/utils/password.util';
import { generateToken } from '../../common/utils/jwt.util';
import { AppError } from '../../common/middleware/error.middleware';
import { auditService, AuditCategory, AuditAction } from '../audit/audit.service';

interface RegisterDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  tenantSlug: string;
}

interface LoginDto {
  email: string;
  password: string;
  tenantSlug: string;
}

interface SaasRegisterDto {
  email: string;
  password: string;
  storeName: string;
  firstName?: string;
  lastName?: string;
}

export class AuthService {
  async register(data: RegisterDto) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: data.tenantSlug },
    });

    if (!tenant) {
      throw new AppError('Tenant not found', 404);
    }

    if (!tenant.isActive) {
      throw new AppError('Tenant is inactive', 403);
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        email_tenantId: {
          email: data.email,
          tenantId: tenant.id,
        },
      },
    });

    if (existingUser) {
      throw new AppError('User already exists', 409);
    }

    const hashedPassword = await hashPassword(data.password);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        tenantId: tenant.id,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
      },
    });

    const token = generateToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });

    return {
      user,
      token,
    };
  }

  async saasRegister(data: SaasRegisterDto) {
    // Generate unique slug from store name
    const baseSlug = data.storeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    
    let slug = baseSlug;
    let counter = 1;
    
    // Ensure unique slug
    while (await prisma.tenant.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // Create tenant with trial lifecycle
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    const tenant = await prisma.tenant.create({
      data: {
        name: data.storeName,
        slug: slug,
        isActive: true,
        status: 'TRIAL',
        trialEndsAt,
      },
    });

    // Create default settings
    await prisma.settings.create({
      data: {
        tenantId: tenant.id,
        siteName: data.storeName,
        currency: 'TRY',
        language: 'tr',
      },
    });

    // Create user
    const hashedPassword = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        firstName: data.firstName || data.email.split('@')[0],
        lastName: data.lastName || 'Admin',
        role: 'ADMIN',
        tenantId: tenant.id,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
      },
    });

    // Create demo data
    await this.createDemoData(tenant.id);

    const token = generateToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });

    await auditService.log({
      userId:   user.id,
      userEmail: user.email,
      userRole:  user.role,
      tenantId:  tenant.id,
      action:    AuditAction.REGISTER,
      category:  AuditCategory.AUTH,
      targetType: 'User', targetId: user.id,
      details: { tenantName: tenant.name, tenantSlug: tenant.slug },
    });

    return {
      user,
      token,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
    };
  }

  private async createDemoData(tenantId: string) {
    // Create demo categories
    const electronicsCategory = await prisma.category.create({
      data: {
        name: 'Elektronik',
        slug: 'elektronik',
        tenantId,
      },
    });

    const clothingCategory = await prisma.category.create({
      data: {
        name: 'Giyim',
        slug: 'giyim',
        tenantId,
      },
    });

    // Create demo products
    await prisma.product.createMany({
      data: [
        {
          name: 'Akıllı Telefon',
          slug: 'akilli-telefon',
          description: 'En yeni akıllı telefon modeli',
          price: 9999.99,
          sku: 'PHONE-001',
          categoryId: electronicsCategory.id,
          tenantId,
          images: ['https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400'],
        },
        {
          name: 'Laptop',
          slug: 'laptop',
          description: 'Yüksek performanslı laptop',
          price: 15999.99,
          sku: 'LAPTOP-001',
          categoryId: electronicsCategory.id,
          tenantId,
          images: ['https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400'],
        },
        {
          name: 'T-Shirt',
          slug: 't-shirt',
          description: 'Rahat pamuklu t-shirt',
          price: 199.99,
          sku: 'SHIRT-001',
          categoryId: clothingCategory.id,
          tenantId,
          images: ['https://images.unsplash.com/photo-1521572163474-68c4708d98c5?w=400'],
        },
      ],
    });

    // Create demo shipping methods
    await prisma.shippingMethod.createMany({
      data: [
        {
          name: 'Standart Kargo',
          description: '3-5 iş günü içinde teslimat',
          price: 29.99,
          estimatedDays: 3,
          tenantId,
        },
        {
          name: 'Hızlı Kargo',
          description: '1-2 iş günü içinde teslimat',
          price: 49.99,
          estimatedDays: 1,
          tenantId,
        },
      ],
    });

    // Create demo pages
    await prisma.page.createMany({
      data: [
        {
          title: 'Hakkımızda',
          slug: 'hakkimizda',
          sections: JSON.stringify([
            {
              type: 'hero',
              title: 'Mağazamız Hoş Geldiniz',
              description: 'En iyi ürünler en uygun fiyatlarla',
            },
            {
              type: 'text',
              content: '2024 yılında kurulan mağazamız, müşteri memnuniyetini ön planda tutar.',
            },
          ]),
          isPublished: true,
          tenantId,
        },
        {
          title: 'İletişim',
          slug: 'iletisim',
          sections: JSON.stringify([
            {
              type: 'contact',
              title: 'Bize Ulaşın',
              email: 'info@magaza.com',
              phone: '+90 555 123 45 67',
            },
          ]),
          isPublished: true,
          tenantId,
        },
      ],
    });
  }

  async login(data: LoginDto) {
    // SUPER_ADMIN can log in with only email + password (no tenant slug needed)
    if (!data.tenantSlug) {
      const superAdmin = await prisma.user.findFirst({
        where: { email: data.email, role: 'SUPER_ADMIN' },
      });

      if (!superAdmin) {
        throw new AppError('Invalid credentials', 401);
      }

      if (!superAdmin.isActive) {
        throw new AppError('User is inactive', 403);
      }

      const isValid = await comparePassword(data.password, superAdmin.password);
      if (!isValid) {
        throw new AppError('Invalid credentials', 401);
      }

      const token = generateToken({
        userId: superAdmin.id,
        tenantId: superAdmin.tenantId,
        email: superAdmin.email,
        role: superAdmin.role,
      });

      await auditService.log({
        userId: superAdmin.id, userEmail: superAdmin.email, userRole: superAdmin.role,
        action: AuditAction.LOGIN, category: AuditCategory.AUTH,
        targetType: 'User', targetId: superAdmin.id,
        details: { loginType: 'SUPER_ADMIN' },
      });

      return {
        user: {
          id: superAdmin.id,
          email: superAdmin.email,
          firstName: superAdmin.firstName,
          lastName: superAdmin.lastName,
          role: superAdmin.role,
          tenantId: superAdmin.tenantId,
        },
        token,
      };
    }

    // Normal tenant login
    const tenant = await prisma.tenant.findUnique({
      where: { slug: data.tenantSlug },
    });

    if (!tenant) {
      throw new AppError('Invalid credentials', 401);
    }

    if (!tenant.isActive) {
      throw new AppError('Tenant is inactive', 403);
    }

    const user = await prisma.user.findUnique({
      where: {
        email_tenantId: {
          email: data.email,
          tenantId: tenant.id,
        },
      },
    });

    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    if (!user.isActive) {
      throw new AppError('User is inactive', 403);
    }

    const isPasswordValid = await comparePassword(data.password, user.password);

    if (!isPasswordValid) {
      throw new AppError('Invalid credentials', 401);
    }

    const token = generateToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });

    await auditService.log({
      userId: user.id, userEmail: user.email, userRole: user.role,
      tenantId: user.tenantId ?? undefined,
      action: AuditAction.LOGIN, category: AuditCategory.AUTH,
      targetType: 'User', targetId: user.id,
      details: { tenantSlug: data.tenantSlug },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
      },
      token,
    };
  }
}
