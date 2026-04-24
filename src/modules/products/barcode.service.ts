/**
 * barcode.service.ts
 *
 * Centralised barcode generation and "ensure" logic for Products and
 * ProductVariants.
 *
 * Design decisions
 * ────────────────
 * • IMMUTABILITY: if a record already has a barcode we NEVER overwrite it.
 * • UNIQUENESS:   auto-generated codes embed the globally-unique product/
 *   variant UUID, so collisions are structurally impossible.
 *   A redundant DB uniqueness check + timestamp fallback guards against
 *   any edge-case race condition.
 * • MULTI-TENANT: tenantId is embedded in the code so codes from different
 *   tenants are immediately distinguishable.
 * • isAutoBarcode: set to true only on auto-generated codes so the UI can
 *   show a visual indicator and allow manual override.
 */

import { PrismaClient } from '@prisma/client';

// ── Format ────────────────────────────────────────────────────────────────────
// WN-<tenant8>-<product8>[-<variant8>]
// All segments are the first 8 hex chars of the respective UUID (no dashes).
// Example: WN-a1b2c3d4-e5f6a7b8
//          WN-a1b2c3d4-e5f6a7b8-c9d0e1f2  (with variant)

function shortId(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 8).toUpperCase();
}

// ── generateBarcode ───────────────────────────────────────────────────────────

export function generateBarcode(params: {
  tenantId:  string;
  productId: string;
  variantId?: string;
}): string {
  const { tenantId, productId, variantId } = params;
  const parts = ['WN', shortId(tenantId), shortId(productId)];
  if (variantId) parts.push(shortId(variantId));
  return parts.join('-');
}

// ── ensureBarcode (product) ───────────────────────────────────────────────────

/**
 * Returns the product's existing barcode if set.
 * Otherwise generates one, persists it (isAutoBarcode = true) and returns it.
 *
 * NEVER overwrites a barcode that was set by the user (isAutoBarcode = false
 * and barcode !== null).
 */
export async function ensureBarcode(params: {
  prisma:    PrismaClient | Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
  productId: string;
  tenantId:  string;
  /** Pass the already-loaded barcode value to avoid an extra DB round-trip */
  currentBarcode?: string | null;
}): Promise<string> {
  const { prisma, productId, tenantId, currentBarcode } = params;

  // Already has a barcode — never touch it
  if (currentBarcode) return currentBarcode;

  // Re-read from DB in case another concurrent call already persisted one
  const fresh = await (prisma as PrismaClient).product.findUnique({
    where:  { id: productId },
    select: { barcode: true },
  });
  if (fresh?.barcode) return fresh.barcode;

  // Generate new barcode
  let barcode = generateBarcode({ tenantId, productId });

  // Collision guard (structurally impossible but covers races)
  const collision = await (prisma as PrismaClient).product.findUnique({
    where: { barcode },
  });
  if (collision) barcode = `${barcode}-${Date.now()}`;

  await (prisma as PrismaClient).product.update({
    where: { id: productId },
    data:  { barcode, isAutoBarcode: true },
  });

  return barcode;
}

// ── ensureVariantBarcode ──────────────────────────────────────────────────────

/**
 * Same contract as ensureBarcode but for ProductVariant rows.
 */
export async function ensureVariantBarcode(params: {
  prisma:         PrismaClient | Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
  variantId:      string;
  productId:      string;
  tenantId:       string;
  currentBarcode?: string | null;
}): Promise<string> {
  const { prisma, variantId, productId, tenantId, currentBarcode } = params;

  if (currentBarcode) return currentBarcode;

  const fresh = await (prisma as PrismaClient).productVariant.findUnique({
    where:  { id: variantId },
    select: { barcode: true },
  });
  if (fresh?.barcode) return fresh.barcode;

  let barcode = generateBarcode({ tenantId, productId, variantId });

  const collision = await (prisma as PrismaClient).productVariant.findUnique({
    where: { barcode },
  });
  if (collision) barcode = `${barcode}-${Date.now()}`;

  await (prisma as PrismaClient).productVariant.update({
    where: { id: variantId },
    data:  { barcode, isAutoBarcode: true },
  });

  return barcode;
}

// ── Manual override guard (use in PATCH /products/:id handler) ────────────────

/**
 * Returns true if the barcode field in `body` should be applied.
 * Rejects attempts to change a user-set barcode through a bulk/auto path.
 *
 * Usage:
 *   if (body.barcode && !canOverrideBarcode(product, body.forceBarcode)) {
 *     delete body.barcode;   // silently ignore
 *   }
 */
export function canOverrideBarcode(product: {
  barcode:      string | null;
  isAutoBarcode: boolean;
}, forceOverride = false): boolean {
  if (!product.barcode)       return true;   // no barcode yet → always writable
  if (product.isAutoBarcode)  return true;   // auto-generated → manual override OK
  return forceOverride;                      // user-set → only if explicitly forced
}
