import { PrismaClient } from '@prisma/client';
import { toCsvString, PRODUCT_COLUMNS, CUSTOMER_COLUMNS, ORDER_EXPORT_COLUMNS } from './csv.util';

const prisma = new PrismaClient();

// ─── Products ─────────────────────────────────────────────────────────────────

export async function exportProducts(tenantId: string): Promise<string> {
  const products = await prisma.product.findMany({
    where:   { tenantId },
    include: { category: true },
    orderBy: { createdAt: 'desc' },
  });

  const rows = products.map(p => ({
    name:         p.name,
    slug:         p.slug,
    description:  p.description ?? '',
    price:        Number(p.price),
    basePrice:    p.basePrice != null ? Number(p.basePrice) : '',
    sku:          p.sku ?? '',
    isActive:     p.isActive,
    categoryName: (p as any).category?.name ?? '',
    unitType:     p.unitType,
    minQuantity:  p.minQuantity,
    maxQuantity:  p.maxQuantity ?? '',
    images:       (p.images as string[]).join('|'),
  }));

  return toCsvString(rows, PRODUCT_COLUMNS);
}

// ─── Customers ────────────────────────────────────────────────────────────────

export async function exportCustomers(tenantId: string): Promise<string> {
  const customers = await prisma.customer.findMany({
    where:   { tenantId },
    orderBy: { createdAt: 'desc' },
  });

  const rows = customers.map(c => ({
    email:     c.email,
    firstName: c.firstName,
    lastName:  c.lastName,
    phone:     c.phone    ?? '',
    address:   c.address  ?? '',
    city:      c.city     ?? '',
    country:   c.country  ?? '',
    zipCode:   c.zipCode  ?? '',
  }));

  return toCsvString(rows, CUSTOMER_COLUMNS);
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function exportOrders(
  tenantId: string,
  filters?: { from?: Date; to?: Date; status?: string },
): Promise<string> {
  const where: any = { tenantId };
  if (filters?.status) where.status  = filters.status;
  if (filters?.from || filters?.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to   ? { lte: filters.to   } : {}),
    };
  }

  const orders = await prisma.order.findMany({
    where,
    include: {
      customer: { select: { email: true, firstName: true, lastName: true } },
      items:    { select: { id: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const rows = orders.map(o => ({
    orderNumber:    o.orderNumber,
    status:         o.status,
    totalAmount:    Number(o.totalAmount),
    shippingPrice:  Number(o.shippingPrice),
    discountAmount: Number(o.discountAmount),
    customerEmail:  (o as any).customer?.email ?? '',
    customerName:   `${(o as any).customer?.firstName ?? ''} ${(o as any).customer?.lastName ?? ''}`.trim(),
    itemCount:      (o as any).items?.length ?? 0,
    notes:          o.notes ?? '',
    createdAt:      new Date(o.createdAt),
  }));

  return toCsvString(rows, ORDER_EXPORT_COLUMNS);
}

// ─── Template CSVs (for import guidance) ─────────────────────────────────────

export function productTemplate(): string {
  const example = [{
    name:         'Örnek Ürün',
    slug:         '',
    description:  'Ürün açıklaması',
    price:        '99.90',
    basePrice:    '149.90',
    sku:          'SKU-001',
    isActive:     'true',
    categoryName: 'Elektronik',
    unitType:     'piece',
    minQuantity:  '1',
    maxQuantity:  '',
    images:       'https://example.com/img1.jpg|https://example.com/img2.jpg',
  }];

  return '\uFEFF' + PRODUCT_COLUMNS.join(',') + '\n' +
    example.map(r => PRODUCT_COLUMNS.map(c => `"${(r as any)[c] ?? ''}"`).join(',')).join('\n');
}

export function customerTemplate(): string {
  const example = [{
    email:     'ornek@email.com',
    firstName: 'Ahmet',
    lastName:  'Yılmaz',
    phone:     '+905551234567',
    address:   'Atatürk Cad. No:1',
    city:      'Istanbul',
    country:   'Turkey',
    zipCode:   '34000',
  }];

  return '\uFEFF' + CUSTOMER_COLUMNS.join(',') + '\n' +
    example.map(r => CUSTOMER_COLUMNS.map(c => `"${(r as any)[c] ?? ''}"`).join(',')).join('\n');
}
