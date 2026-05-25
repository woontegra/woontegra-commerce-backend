import prisma from '../../config/database';
import { hashPassword, comparePassword } from '../../common/utils/password.util';
import { generateToken } from '../../common/utils/jwt.util';
import { TenantUsageAction, type UserRole } from '@prisma/client';
import { AppError } from '../../common/middleware/AppError';
import { auditService, AuditCategory, AuditAction } from '../audit/audit.service';
import { logTenantUsage } from '../../services/tenantUsageLog.service';
import { syncTenantDomainsFromTenant } from '../../services/tenantDomainSync.service';
import { checkProductLimit } from '../../services/planQuota.service';
import { authLogger } from '../../common/logging/loggers';
import { syncOnboardingCompletionForTenant } from '../../services/onboardingCompletion.service';

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
  kvkkAccepted: boolean;
  privacyAccepted: boolean;
  termsAccepted: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export class AuthService {
  async register(data: RegisterDto) {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { slug: data.tenantSlug },
      });

      if (!tenant) {
        authLogger.warn({
          action: 'register',
          status: 'failure',
          message: 'Tenant not found',
          tenantSlug: data.tenantSlug,
        });
        throw new AppError('Tenant not found', 404);
      }

      if (!tenant.isActive) {
        authLogger.warn({
          action: 'register',
          status: 'failure',
          tenantId: tenant.id,
          message: 'Tenant inactive',
        });
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
        authLogger.warn({
          action: 'register',
          status: 'failure',
          tenantId: tenant.id,
          message: 'User already exists',
        });
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

      authLogger.info({
        action: 'register',
        status: 'success',
        tenantId: user.tenantId,
        userId: user.id,
      });

      return { user, token };
    } catch (err) {
      if (!(err instanceof AppError)) {
        authLogger.error({ action: 'register', status: 'failure', error: err });
      }
      throw err;
    }
  }

  async saasRegister(data: SaasRegisterDto) {
    if (!data.kvkkAccepted || !data.privacyAccepted || !data.termsAccepted) {
      throw new AppError('Devam etmek için KVKK, Gizlilik ve Kullanım Şartlarını kabul etmelisiniz.', 400);
    }

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

    await syncTenantDomainsFromTenant({
      id:               tenant.id,
      subdomain:        tenant.subdomain,
      customDomain:     tenant.customDomain,
      domainVerified:   tenant.domainVerified,
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

    await prisma.legalAcceptance.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        email: user.email,
        kvkkAccepted: data.kvkkAccepted,
        privacyAccepted: data.privacyAccepted,
        termsAccepted: data.termsAccepted,
        ipAddress: data.ipAddress || null,
        userAgent: data.userAgent || null,
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

    // Create demo products (kotaya sığmıyorsa ürünler atlanır; kargo/sayfalar yine oluşturulur)
    try {
      await checkProductLimit(tenantId, 3);
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
    } catch { /* plan limiti — demo ürün yok */ }

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
    try {
      return await this._loginInternal(data);
    } catch (err) {
      if (!(err instanceof AppError)) {
        authLogger.error({ action: 'login', status: 'failure', error: err });
      }
      throw err;
    }
  }

  private normalizeTenantSlug(slug?: string): string | undefined {
    const trimmed = slug?.trim();
    if (!trimmed) return undefined;
    const placeholders = new Set(['magaza-slug', 'magaza slug', 'tenant-slug', 'slug']);
    if (placeholders.has(trimmed.toLowerCase())) return undefined;
    return trimmed;
  }

  private async _loginInternal(data: LoginDto) {
    const tenantSlug = this.normalizeTenantSlug(data.tenantSlug);

    // SUPER_ADMIN can log in with only email + password (no tenant slug needed)
    if (!tenantSlug) {
      const superAdmin = await prisma.user.findFirst({
        where: {
          email: data.email,
          role: { in: ['OWNER', 'SUPER_ADMIN'] as UserRole[] },
        },
      });

      if (!superAdmin) {
        throw new AppError('E-posta veya şifre hatalı. Süper admin için mağaza slug alanını boş bırakın.', 401);
      }

      if (!superAdmin.isActive) {
        throw new AppError('User is inactive', 403);
      }

      const isValid = await comparePassword(data.password, superAdmin.password);
      if (!isValid) {
        throw new AppError('E-posta veya şifre hatalı.', 401);
      }

      const token = generateToken({
        userId: superAdmin.id,
        tenantId: superAdmin.tenantId,
        email: superAdmin.email,
        role: superAdmin.role,
      });

      await prisma.user.update({
        where: { id: superAdmin.id },
        data:  { lastLoginAt: new Date() },
      }).catch(() => {});

      await auditService.log({
        userId: superAdmin.id, userEmail: superAdmin.email, userRole: superAdmin.role,
        action: AuditAction.LOGIN, category: AuditCategory.AUTH,
        targetType: 'User', targetId: superAdmin.id,
        details: { loginType: 'SUPER_ADMIN' },
      });

      authLogger.info({
        action: 'login',
        status: 'success',
        userId: superAdmin.id,
        tenantId: superAdmin.tenantId,
        loginType: 'SUPER_ADMIN',
      });

      return {
        user: {
          id: superAdmin.id,
          email: superAdmin.email,
          firstName: superAdmin.firstName,
          lastName: superAdmin.lastName,
          role: superAdmin.role,
          tenantId: superAdmin.tenantId,
          onboardingCompleted: superAdmin.onboardingCompleted,
          onboardingStep: superAdmin.onboardingStep,
        },
        token,
      };
    }

    // Normal tenant login
    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });

    if (!tenant) {
      authLogger.warn({ action: 'login', status: 'failure', message: 'Tenant not found', tenantSlug });
      throw new AppError('Bu mağaza slug bulunamadı. Kayıt olurken seçtiğiniz slug\'ı girin.', 401);
    }

    if (!tenant.isActive) {
      authLogger.warn({ action: 'login', status: 'failure', tenantId: tenant.id, message: 'Tenant inactive' });
      throw new AppError('Tenant is inactive', 403);
    }

    let user = await prisma.user.findUnique({
      where: {
        email_tenantId: {
          email: data.email,
          tenantId: tenant.id,
        },
      },
    });

    if (!user) {
      authLogger.warn({ action: 'login', status: 'failure', tenantId: tenant.id, message: 'User not found' });
      throw new AppError('Bu e-posta bu mağazada kayıtlı değil.', 401);
    }

    if (!user.isActive) {
      authLogger.warn({ action: 'login', status: 'failure', tenantId: tenant.id, userId: user.id, message: 'User inactive' });
      throw new AppError('User is inactive', 403);
    }

    const isPasswordValid = await comparePassword(data.password, user.password);

    if (!isPasswordValid) {
      authLogger.warn({ action: 'login', status: 'failure', tenantId: tenant.id, userId: user.id, message: 'Wrong password' });
      throw new AppError('Şifre hatalı.', 401);
    }

    const token = generateToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });

    await prisma.user.update({
      where: { id: user.id },
      data:  { lastLoginAt: new Date() },
    }).catch(() => {});

    await auditService.log({
      userId: user.id, userEmail: user.email, userRole: user.role,
      tenantId: user.tenantId ?? undefined,
      action: AuditAction.LOGIN, category: AuditCategory.AUTH,
      targetType: 'User', targetId: user.id,
      details: { tenantSlug: data.tenantSlug },
    });

    logTenantUsage(user.tenantId, TenantUsageAction.LOGIN);

    if (!user.onboardingCompleted) {
      await syncOnboardingCompletionForTenant(user.tenantId);
      const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
      if (refreshed) user = refreshed;
    }

    authLogger.info({
      action: 'login',
      status: 'success',
      tenantId: user.tenantId,
      userId: user.id,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
        onboardingCompleted: user.onboardingCompleted,
        onboardingStep: user.onboardingStep,
      },
      token,
    };
  }

  // ─── Demo Login ────────────────────────────────────────────────────────────
  //
  // Her çağrıda kalıcı bir "demo" tenant + user bulur veya oluşturur.
  // Son veri reset'inden bu yana 2+ saat geçmişse seed datayı yeniden yükler.
  // Dönen JWT'de isDemo:true bayrağı bulunur.

  async demoLogin() {
    const DEMO_SLUG     = 'woontegra-demo';
    const DEMO_EMAIL    = 'demo@site.com';
    const DEMO_PASSWORD = 'demo123456';
    const RESET_HOURS   = 2;

    // ── 1. Demo tenant bul ya da oluştur ────────────────────────────────────
    let tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG } });

    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          name:     'Demo Mağaza',
          slug:     DEMO_SLUG,
          isActive: true,
          status:   'ACTIVE',
        },
      });

      // Settings
      await prisma.settings.create({
        data: {
          tenantId: tenant.id,
          siteName: 'Demo Mağaza',
          currency: 'TRY',
          language: 'tr',
        },
      });
    }

    // ── 2. Demo user bul ya da oluştur ──────────────────────────────────────
    let user = await prisma.user.findFirst({
      where: { tenantId: tenant.id, email: DEMO_EMAIL },
    });

    if (!user) {
      const hashed = await hashPassword(DEMO_PASSWORD);
      user = await prisma.user.create({
        data: {
          email:     DEMO_EMAIL,
          password:  hashed,
          firstName: 'Demo',
          lastName:  'Kullanıcı',
          role:      'ADMIN',
          tenantId:  tenant.id,
        },
      });
    }

    // ── 3. Veri sıfırlama kontrolü (2 saat) ─────────────────────────────────
    // Son reset zamanını tenant.updatedAt ile takip ediyoruz.
    // Eğer 2 saatten fazla geçmişse tüm demo verilerini silip yeniden oluştur.
    const hoursSinceUpdate = (Date.now() - new Date(tenant.updatedAt).getTime()) / 3_600_000;

    if (hoursSinceUpdate >= RESET_HOURS) {
      try {
        await this.resetDemoData(tenant.id);
        await prisma.tenant.update({ where: { id: tenant.id }, data: { name: tenant.name } });
      } catch (err) {
        authLogger.warn({ action: 'demo_login', status: 'failure', message: 'Demo reset skipped', error: err });
      }
    } else {
      const productCount = await prisma.product.count({ where: { tenantId: tenant.id } });
      if (productCount === 0) {
        try {
          await this.seedDemoData(tenant.id);
        } catch (err) {
          authLogger.warn({ action: 'demo_login', status: 'failure', message: 'Demo seed skipped', error: err });
        }
      }
    }

    // Demo mağazada ürün varsa onboarding'i tamamla (dashboard döngüsünü önler)
    const demoProductCount = await prisma.product.count({ where: { tenantId: tenant.id } });
    if (demoProductCount >= 1 && !user.onboardingCompleted) {
      await syncOnboardingCompletionForTenant(tenant.id);
      user = (await prisma.user.findUnique({ where: { id: user.id } })) ?? user;
    }

    // ── 4. Token üret ───────────────────────────────────────────────────────
    const token = generateToken({
      userId:   user.id,
      tenantId: user.tenantId!,
      email:    user.email,
      role:     user.role,
      isDemo:   true,
    });

    // Sonraki reset zamanını hesapla
    const nextReset = new Date(new Date(tenant.updatedAt).getTime() + RESET_HOURS * 3_600_000);

    return {
      user: {
        id:        user.id,
        email:     user.email,
        firstName: user.firstName,
        lastName:  user.lastName,
        role:      user.role,
        tenantId:  user.tenantId,
        onboardingCompleted: user.onboardingCompleted ?? demoProductCount >= 1,
        onboardingStep: user.onboardingStep ?? (demoProductCount >= 1 ? 4 : 0),
        isDemo:    true,
      },
      token,
      demo: {
        nextReset,
        resetIntervalHours: RESET_HOURS,
        tenantSlug: DEMO_SLUG,
      },
    };
  }

  private async resetDemoData(tenantId: string) {
    // Ürün bağlı kayıtları sırasıyla sil
    await prisma.trendyolProductMap.deleteMany({ where: { tenantId } });
    await prisma.orderItem.deleteMany({ where: { order: { tenantId } } });
    await prisma.order.deleteMany({ where: { tenantId } });
    await prisma.productVariant.deleteMany({ where: { product: { tenantId } } });
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.category.deleteMany({ where: { tenantId } });
    await this.seedDemoData(tenantId);
  }

  private async seedDemoData(tenantId: string) {
    // ── Kategoriler ──────────────────────────────────────────────────────────
    const catData = [
      { name: 'Elektronik',      slug: 'elektronik-demo' },
      { name: 'Giyim & Moda',    slug: 'giyim-demo' },
      { name: 'Ev & Yaşam',      slug: 'ev-yasam-demo' },
      { name: 'Spor & Outdoor',  slug: 'spor-demo' },
      { name: 'Kozmetik',        slug: 'kozmetik-demo' },
    ];

    const cats: Record<string, any> = {};
    for (const c of catData) {
      // slug unique constraint — demo prefix ile çakışmayı önle
      const existing = await prisma.category.findFirst({ where: { slug: c.slug, tenantId } });
      cats[c.name] = existing ?? await prisma.category.create({ data: { ...c, tenantId } });
    }

    // ── Ürünler ──────────────────────────────────────────────────────────────
    const products = [
      // Elektronik
      { name: 'iPhone 15 Pro Max', slug: 'iphone-15-pro-max-demo', sku: 'IPH-15PM-D', price: 59999, stockQuantity: 24, categoryId: cats['Elektronik'].id,
        description: '6.7" Super Retina XDR ekran, A17 Pro çip, 48MP kamera sistemi. ProRAW ve ProRes video.',
        images: ['https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600'] },
      { name: 'MacBook Air M3', slug: 'macbook-air-m3-demo', sku: 'MAC-AIR-M3-D', price: 45999, stockQuantity: 12, categoryId: cats['Elektronik'].id,
        description: '15" Liquid Retina ekran, M3 çip, 18 saat pil ömrü.',
        images: ['https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600'] },
      { name: 'Sony WH-1000XM5 Kulaklık', slug: 'sony-wh1000xm5-demo', sku: 'SONY-XM5-D', price: 8499, stockQuantity: 38, categoryId: cats['Elektronik'].id,
        description: 'Endüstri lideri gürültü önleme, 30 saat pil, katlanabirli tasarım.',
        images: ['https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600'] },
      { name: 'iPad Pro 12.9"', slug: 'ipad-pro-129-demo', sku: 'IPAD-PRO-D', price: 32999, stockQuantity: 15, categoryId: cats['Elektronik'].id,
        description: 'M2 çip, mini LED ekran, Apple Pencil 2 desteği.',
        images: ['https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600'] },
      // Giyim
      { name: 'Premium Deri Mont', slug: 'premium-deri-mont-demo', sku: 'MONT-DER-D', price: 3499, stockQuantity: 50, categoryId: cats['Giyim & Moda'].id,
        description: 'Gerçek inek derisi, slim fit kesim, kışlık astar.',
        images: ['https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600'] },
      { name: 'Organik Pamuk T-Shirt', slug: 'organik-pamuk-tshirt-demo', sku: 'TSHIRT-ORG-D', price: 299, stockQuantity: 200, categoryId: cats['Giyim & Moda'].id,
        description: '%100 organik pamuk, GOTS sertifikalı, 12 renk seçeneği.',
        images: ['https://images.unsplash.com/photo-1521572163474-68c4708d98c5?w=600'] },
      { name: 'Slim Fit Chino Pantolon', slug: 'slim-fit-chino-demo', sku: 'PANT-CHN-D', price: 899, stockQuantity: 80, categoryId: cats['Giyim & Moda'].id,
        description: 'Streç twill kumaş, 5 cep, 8 renk.',
        images: ['https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=600'] },
      // Ev & Yaşam
      { name: 'Kahve Makinesi (Espresso)', slug: 'espresso-kahve-makinesi-demo', sku: 'KAHVE-ESP-D', price: 4999, stockQuantity: 30, categoryId: cats['Ev & Yaşam'].id,
        description: '15 bar basınç, buharlı milk frother, 1.8L su haznesi.',
        images: ['https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600'] },
      { name: 'Robot Süpürge', slug: 'robot-supurge-demo', sku: 'ROB-SUP-D', price: 6499, stockQuantity: 22, categoryId: cats['Ev & Yaşam'].id,
        description: 'Lazer navigasyon, 300 dk pil, otomatik şarj ve boşaltma.',
        images: ['https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600'] },
      // Spor
      { name: 'Koşu Ayakkabısı Pro', slug: 'kosu-ayakkabisi-pro-demo', sku: 'AYAK-KOS-D', price: 2299, stockQuantity: 60, categoryId: cats['Spor & Outdoor'].id,
        description: 'React foam taban, Flyknit üst, karbon fiber plak.',
        images: ['https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600'] },
      { name: 'Yoga Mat (6mm)', slug: 'yoga-mat-6mm-demo', sku: 'YOGA-MAT-D', price: 499, stockQuantity: 100, categoryId: cats['Spor & Outdoor'].id,
        description: 'Anti-kayma yüzey, TPE malzeme, taşıma askısı dahil.',
        images: ['https://images.unsplash.com/photo-1601925228886-a5df26cabd00?w=600'] },
      // Kozmetik
      { name: 'Hyalüronik Asit Serum', slug: 'hiyaluronik-asit-serum-demo', sku: 'SER-HYA-D', price: 649, stockQuantity: 150, categoryId: cats['Kozmetik'].id,
        description: '%2 HA konsantrasyonu, 50ml, vegan & cruelty-free.',
        images: ['https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600'] },
      { name: 'SPF 50+ Güneş Kremi', slug: 'spf50-gunes-kremi-demo', sku: 'GUNES-SPF-D', price: 349, stockQuantity: 200, categoryId: cats['Kozmetik'].id,
        description: 'UVA/UVB koruması, su geçirmez, mineral bazlı.',
        images: ['https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600'] },
    ];

    for (const p of products) {
      const { stockQuantity, ...productFields } = p;
      const existing = await prisma.product.findFirst({ where: { sku: p.sku, tenantId } });
      if (!existing) {
        try {
          await checkProductLimit(tenantId, 1);
        } catch {
          break;
        }
        await prisma.product.create({
          data: {
            ...productFields,
            tenantId,
            isActive: true,
            stock: {
              create: {
                quantity: stockQuantity,
                tenantId,
              },
            },
          },
        });
      }
    }
  }
}
