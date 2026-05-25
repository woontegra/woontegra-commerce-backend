/**
 * Local vitrin test verisi — Demo Mağaza (slug: demo)
 *
 *   npm run seed:demo
 *
 * Idempotent: tekrar çalıştırılabilir.
 * Mevcut ilk kullanıcıyı demo tenant'a taşır (geliştirme ortamı).
 */

import 'dotenv/config';
import { Prisma, TenantStatus, UserRole } from '@prisma/client';
import prisma from '../src/config/database';
import { tenantPaymentSettingsService } from '../src/modules/payments/tenant-payment-settings.service';
import { tenantShippingSettingsService } from '../src/modules/shipping/tenant-shipping-settings.service';

const DEMO_SLUG = 'demo';

const CATEGORIES = [
  { name: 'Elektronik', slug: 'elektronik', description: 'Elektronik ürünler' },
  { name: 'Giyim', slug: 'giyim', description: 'Giyim ve aksesuar' },
  { name: 'Ev & Yaşam', slug: 'ev-yasam', description: 'Ev ve yaşam ürünleri' },
] as const;

type ProductSeed = {
  name: string;
  slug: string;
  categorySlug: string;
  description: string;
  salePrice: number;
  discountPrice?: number;
  stock: number;
  sku: string;
  barcode: string;
  imageUrl: string;
};

const PRODUCTS: ProductSeed[] = [
  {
    name: 'Bluetooth Kulaklık',
    slug: 'bluetooth-kulaklik',
    categorySlug: 'elektronik',
    description: 'Gürültü engelleme özellikli kablosuz kulaklık.',
    salePrice: 1299,
    discountPrice: 999,
    stock: 25,
    sku: 'DEMO-BT-01',
    barcode: '8699000001001',
    imageUrl: 'https://placehold.co/800x800/png?text=Kulaklik',
  },
  {
    name: 'Akıllı Saat',
    slug: 'akilli-saat',
    categorySlug: 'elektronik',
    description: 'Adım sayar, nabız ve bildirim desteği.',
    salePrice: 2499,
    stock: 15,
    sku: 'DEMO-WATCH-01',
    barcode: '8699000001002',
    imageUrl: 'https://placehold.co/800x800/png?text=Akilli+Saat',
  },
  {
    name: 'USB-C Kablo',
    slug: 'usb-c-kablo',
    categorySlug: 'elektronik',
    description: '2 m hızlı şarj destekli USB-C kablo.',
    salePrice: 199,
    stock: 100,
    sku: 'DEMO-CABLE-01',
    barcode: '8699000001003',
    imageUrl: 'https://placehold.co/800x800/png?text=USB-C',
  },
  {
    name: 'Pamuklu T-Shirt',
    slug: 'pamuklu-t-shirt',
    categorySlug: 'giyim',
    description: '%100 pamuk, unisex kesim.',
    salePrice: 349,
    discountPrice: 279,
    stock: 40,
    sku: 'DEMO-TSHIRT-01',
    barcode: '8699000002001',
    imageUrl: 'https://placehold.co/800x800/png?text=T-Shirt',
  },
  {
    name: 'Spor Şort',
    slug: 'spor-sort',
    categorySlug: 'giyim',
    description: 'Nefes alabilen kumaş, cepli.',
    salePrice: 449,
    stock: 30,
    sku: 'DEMO-SHORT-01',
    barcode: '8699000002002',
    imageUrl: 'https://placehold.co/800x800/png?text=Spor+Sort',
  },
  {
    name: 'Kahve Makinesi',
    slug: 'kahve-makinesi',
    categorySlug: 'ev-yasam',
    description: 'Filtre kahve makinesi, 1.2 L su haznesi.',
    salePrice: 1899,
    stock: 12,
    sku: 'DEMO-COFFEE-01',
    barcode: '8699000003001',
    imageUrl: 'https://placehold.co/800x800/png?text=Kahve',
  },
  {
    name: 'Mutfak Seti',
    slug: 'mutfak-seti',
    categorySlug: 'ev-yasam',
    description: '12 parça paslanmaz çelik mutfak seti.',
    salePrice: 1599,
    discountPrice: 1399,
    stock: 8,
    sku: 'DEMO-KITCHEN-01',
    barcode: '8699000003002',
    imageUrl: 'https://placehold.co/800x800/png?text=Mutfak',
  },
];

async function upsertCategory(
  tenantId: string,
  cat: (typeof CATEGORIES)[number],
): Promise<string> {
  const row = await prisma.category.upsert({
    where:  { slug_tenantId: { slug: cat.slug, tenantId } },
    create: {
      name:        cat.name,
      slug:        cat.slug,
      description: cat.description,
      path:        cat.slug,
      level:       0,
      isActive:    true,
      tenantId,
    },
    update: {
      name:        cat.name,
      description: cat.description,
      isActive:    true,
    },
  });
  return row.id;
}

async function upsertProduct(
  tenantId: string,
  categoryId: string,
  p: ProductSeed,
): Promise<void> {
  const price = new Prisma.Decimal(p.salePrice);
  const discount = p.discountPrice != null ? new Prisma.Decimal(p.discountPrice) : null;

  const product = await prisma.product.upsert({
    where:  { slug_tenantId: { slug: p.slug, tenantId } },
    create: {
      name:        p.name,
      slug:        p.slug,
      description: p.description,
      price,
      sku:         p.sku,
      barcode:     p.barcode,
      status:      'active',
      isActive:    true,
      images:      [p.imageUrl],
      tenantId,
      categoryId,
    },
    update: {
      name:        p.name,
      description: p.description,
      price,
      sku:         p.sku,
      status:      'active',
      isActive:    true,
      images:      [p.imageUrl],
      categoryId,
    },
  });

  await prisma.productPrice.upsert({
    where:  { productId: product.id },
    create: {
      productId:     product.id,
      salePrice:     price,
      discountPrice: discount,
      currency:      'TRY',
      vatRate:       20,
    },
    update: {
      salePrice:     price,
      discountPrice: discount,
      currency:      'TRY',
    },
  });

  await prisma.stock.upsert({
    where:  { productId: product.id },
    create: {
      productId: product.id,
      tenantId,
      quantity:  p.stock,
      unit:      'adet',
    },
    update: { quantity: p.stock },
  });

  const existingImg = await prisma.productImage.findFirst({
    where: { productId: product.id, isMain: true },
  });
  if (!existingImg) {
    await prisma.productImage.create({
      data: {
        productId: product.id,
        url:       p.imageUrl,
        order:     0,
        isMain:    true,
        alt:       p.name,
      },
    });
  } else {
    await prisma.productImage.update({
      where: { id: existingImg.id },
      data:  { url: p.imageUrl, alt: p.name },
    });
  }
}

function assertPrismaPaymentSettingsClient(): void {
  const p = prisma as { tenantPaymentSetting?: { findUnique: unknown } };
  if (!p.tenantPaymentSetting?.findUnique) {
    throw new Error(
      'Prisma client güncel değil (tenantPaymentSetting yok). ' +
        'backend klasöründe çalıştırın: npx prisma generate',
    );
  }
}

async function seedDemoPaymentSettings(tenantId: string): Promise<void> {
  try {
    assertPrismaPaymentSettingsClient();
    await tenantPaymentSettingsService.upsert(tenantId, 'BANK_TRANSFER', {
      isActive:     true,
      isTestMode:   false,
      displayName:  'Havale / EFT',
      bankName:     'Demo Bank',
      accountHolder: 'Demo Mağaza A.Ş.',
      iban:         'TR330006100519786457841326',
      description:  'Açıklamaya sipariş numaranızı yazın.',
    });
    console.log('✓ Ödeme yöntemi: Havale / EFT');

    await tenantPaymentSettingsService.upsert(tenantId, 'CASH_ON_DELIVERY', {
      isActive:    true,
      isTestMode:  false,
      displayName: 'Kapıda Ödeme',
      extraFee:    25,
      description: 'Teslimatta nakit veya kart',
    });
    console.log('✓ Ödeme yöntemi: Kapıda ödeme');

    const mid  = process.env.PAYTR_MERCHANT_ID?.trim();
    const mkey = process.env.PAYTR_MERCHANT_KEY?.trim();
    const salt = process.env.PAYTR_MERCHANT_SALT?.trim();
    if (mid && mkey && salt) {
      await tenantPaymentSettingsService.upsert(tenantId, 'PAYTR', {
        isActive:     true,
        isTestMode:   true,
        displayName:  'Kredi Kartı (PayTR)',
        merchantId:   mid,
        merchantKey:  mkey,
        merchantSalt: salt,
      });
      console.log('✓ Ödeme yöntemi: PayTR (env bilgileriyle)');
    } else {
      console.log('ℹ️  PayTR tenant ayarı atlandı — PAYTR_* env tanımlı değil.');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/MARKETPLACE_ENCRYPTION_KEY|encryption/i.test(msg)) {
      console.warn('⚠ Ödeme ayarları seed edilemedi — .env içine MARKETPLACE_ENCRYPTION_KEY ekleyin (min 16 karakter).');
    } else if (/prisma generate|tenantPaymentSetting/i.test(msg)) {
      console.warn(`⚠ ${msg}`);
    } else {
      console.warn('⚠ Ödeme ayarları seed edilemedi:', msg);
    }
  }
}

async function seedDemoShippingSettings(tenantId: string): Promise<void> {
  try {
    await tenantShippingSettingsService.upsert(tenantId, {
      isActive:              true,
      displayName:           'Standart Kargo',
      standardShippingCost:  79.9,
      freeShippingThreshold: 750,
      description:           '1–3 iş günü içinde kargoya verilir.',
    });
    console.log('✓ Kargo ayarları: 79,90 ₺ / 750 ₺ üzeri ücretsiz');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('⚠ Kargo ayarları seed edilemedi:', msg);
  }
}

async function linkFirstUserToDemo(tenantId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    orderBy: { createdAt: 'asc' },
  });
  if (!user) {
    console.log('ℹ️  Kullanıcı bulunamadı — yalnızca tenant/ürün seed edildi.');
    return;
  }
  if (user.tenantId === tenantId) {
    console.log(`✓ Kullanıcı zaten demo tenant'ta: ${user.email}`);
    return;
  }
  await prisma.user.update({
    where: { id: user.id },
    data:  { tenantId, role: user.role === UserRole.SUPER_ADMIN ? user.role : UserRole.OWNER },
  });
  console.log(`✓ Kullanıcı demo tenant'a bağlandı: ${user.email}`);
}

async function main(): Promise<void> {
  console.log('Demo mağaza seed başlıyor…');

  const tenant = await prisma.tenant.upsert({
    where:  { slug: DEMO_SLUG },
    create: {
      name:     'Demo Mağaza',
      slug:     DEMO_SLUG,
      isActive: true,
      status:   TenantStatus.ACTIVE,
      theme:    'default',
      description: 'Local geliştirme vitrin test mağazası',
    },
    update: {
      name:     'Demo Mağaza',
      isActive: true,
      status:   TenantStatus.ACTIVE,
      theme:    'default',
    },
  });

  await prisma.settings.upsert({
    where:  { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      siteName: 'Demo Mağaza',
      currency: 'TRY',
      language: 'tr',
    },
    update: {
      siteName: 'Demo Mağaza',
      currency: 'TRY',
      language: 'tr',
    },
  });

  const categoryIds: Record<string, string> = {};
  for (const cat of CATEGORIES) {
    categoryIds[cat.slug] = await upsertCategory(tenant.id, cat);
    console.log(`✓ Kategori: ${cat.name}`);
  }

  for (const p of PRODUCTS) {
    const categoryId = categoryIds[p.categorySlug];
    if (!categoryId) throw new Error(`Kategori yok: ${p.categorySlug}`);
    await upsertProduct(tenant.id, categoryId, p);
    console.log(`✓ Ürün: ${p.name}`);
  }

  await linkFirstUserToDemo(tenant.id);
  await seedDemoPaymentSettings(tenant.id);

  console.log('\n--- Demo vitrin hazır ---');
  console.log(`Tenant slug: ${DEMO_SLUG}`);
  console.log(`Tenant id:   ${tenant.id}`);
  console.log('Vitrin: http://localhost:5173/store?tenant=demo');
}

main()
  .catch(e => {
    console.error('Seed hatası:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
