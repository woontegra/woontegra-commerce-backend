import { PrismaClient } from '@prisma/client';
import {
  parseCsv, requireField, parseDecimal, parseInt2,
  RowError, PRODUCT_COLUMNS, CUSTOMER_COLUMNS,
} from './csv.util';
import { generateUniqueProductSlug } from '../../common/utils/slug.utils';
import { searchService, toProductDocument } from '../search/search.service';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ImportResult {
  total:    number;
  created:  number;
  updated:  number;
  skipped:  number;
  errors:   RowError[];
}

// ─── Shared: resolve category by name ────────────────────────────────────────

async function resolveCategoryId(
  name: string, tenantId: string, cache: Map<string, string>,
): Promise<string | null> {
  if (!name?.trim()) return null;
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  let cat = await prisma.category.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, tenantId },
  });
  if (!cat) {
    cat = await prisma.category.create({
      data: {
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        tenantId,
      },
    });
  }
  cache.set(key, cat.id);
  return cat.id;
}

// ─── Product Import ───────────────────────────────────────────────────────────
//
// CSV columns: name, slug, description, price, basePrice, sku, isActive,
//              categoryName, unitType, minQuantity, maxQuantity, images
//
// Upsert strategy: match by sku (if provided) OR by name within tenant.

export async function importProducts(
  buffer:   Buffer,
  tenantId: string,
): Promise<ImportResult> {
  const rows   = await parseCsv(buffer);
  const result: ImportResult = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [] };

  const categoryCache = new Map<string, string>();
  const toIndex: any[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // 1-based + header row
    const row    = rows[i] as Record<string, string>;

    // ── Validate required fields ─────────────────────────────────────────
    const ok = requireField(row, 'name', rowNum, result.errors);
    const price = parseDecimal(row.price, 'price', rowNum, result.errors);
    if (!ok || price === null) {
      result.skipped++;
      continue;
    }

    // ── Optional numerics ────────────────────────────────────────────────
    const basePrice   = row.basePrice?.trim() ? parseDecimal(row.basePrice, 'basePrice', rowNum, result.errors) : null;
    const minQuantity = row.minQuantity?.trim() ? parseInt2(row.minQuantity, 'minQuantity', rowNum, result.errors) : 1;
    const maxQuantity = row.maxQuantity?.trim() ? parseInt2(row.maxQuantity, 'maxQuantity', rowNum, result.errors) : null;

    // ── Category ─────────────────────────────────────────────────────────
    const categoryId = await resolveCategoryId(row.categoryName, tenantId, categoryCache).catch(() => null);

    // ── Images ───────────────────────────────────────────────────────────
    const images = row.images?.trim()
      ? row.images.split('|').map(s => s.trim()).filter(Boolean)
      : [];

    // ── isActive ─────────────────────────────────────────────────────────
    const isActive = row.isActive?.toLowerCase() !== 'false';

    // ── Build data object ────────────────────────────────────────────────
    const productData: Record<string, unknown> = {
      name:        row.name.trim(),
      description: row.description?.trim() || null,
      price,
      basePrice:   basePrice ?? null,
      sku:         row.sku?.trim() || null,
      isActive,
      categoryId,
      unitType:    row.unitType?.trim() || 'piece',
      minQuantity: minQuantity ?? 1,
      maxQuantity: maxQuantity ?? null,
      images,
      tenantId,
    };

    try {
      // ── Try to find existing product ─────────────────────────────────
      let existing: any = null;
      if (productData.sku) {
        existing = await prisma.product.findFirst({
          where: { sku: productData.sku as string, tenantId },
        });
      }
      if (!existing) {
        existing = await prisma.product.findFirst({
          where: { name: { equals: productData.name as string, mode: 'insensitive' }, tenantId },
        });
      }

      if (existing) {
        // ── Update ───────────────────────────────────────────────────
        const updated = await prisma.product.update({
          where:   { id: existing.id },
          data:    productData,
          include: { category: true, variants: true },
        });
        toIndex.push(updated);
        result.updated++;
      } else {
        // ── Create ───────────────────────────────────────────────────
        const slug = row.slug?.trim() || await generateUniqueProductSlug(productData.name as string, tenantId);
        const created = await prisma.product.create({
          data:    { ...(productData as any), slug },
          include: { category: true, variants: true },
        });
        toIndex.push(created);
        result.created++;
      }
    } catch (err: any) {
      result.errors.push({ row: rowNum, field: 'general', message: err.message });
      result.skipped++;
    }
  }

  // ── Bulk index into Meilisearch ──────────────────────────────────────────
  if (toIndex.length) {
    searchService.upsertProducts(toIndex.map(toProductDocument));
  }

  logger.info({
    message:  '[CSV] Product import done',
    tenantId,
    ...result,
  });

  return result;
}

// ─── Customer Import ──────────────────────────────────────────────────────────
//
// CSV columns: email, firstName, lastName, phone, address, city, country, zipCode
//
// Upsert by email within tenant.

export async function importCustomers(
  buffer:   Buffer,
  tenantId: string,
): Promise<ImportResult> {
  const rows   = await parseCsv(buffer);
  const result: ImportResult = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const row    = rows[i] as Record<string, string>;

    const emailOk = requireField(row, 'email',     rowNum, result.errors);
    const fnOk    = requireField(row, 'firstName', rowNum, result.errors);
    const lnOk    = requireField(row, 'lastName',  rowNum, result.errors);
    if (!emailOk || !fnOk || !lnOk) { result.skipped++; continue; }

    const email = row.email.trim().toLowerCase();

    // Simple email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      result.errors.push({ row: rowNum, field: 'email', message: 'Geçersiz e-posta formatı', value: email });
      result.skipped++;
      continue;
    }

    const data = {
      email,
      firstName: row.firstName.trim(),
      lastName:  row.lastName.trim(),
      phone:     row.phone?.trim()   || null,
      address:   row.address?.trim() || null,
      city:      row.city?.trim()    || null,
      country:   row.country?.trim() || null,
      zipCode:   row.zipCode?.trim() || null,
      tenantId,
    };

    try {
      const existing = await prisma.customer.findFirst({
        where: { email, tenantId },
      });

      if (existing) {
        await prisma.customer.update({ where: { id: existing.id }, data });
        result.updated++;
      } else {
        await prisma.customer.create({ data });
        result.created++;
      }
    } catch (err: any) {
      result.errors.push({ row: rowNum, field: 'general', message: err.message });
      result.skipped++;
    }
  }

  logger.info({ message: '[CSV] Customer import done', tenantId, ...result });
  return result;
}
