import prisma from '../../config/database';
import { defaultsForRole, ALL_PERMISSIONS, PermissionKey } from './permissions';

// ─── In-memory cache: userId → { perms, expiresAt } ──────────────────────────

interface CacheEntry {
  perms:     Set<string>;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 1 minute
const cache = new Map<string, CacheEntry>();

function fromCache(userId: string): Set<string> | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(userId); return null; }
  return entry.perms;
}

function toCache(userId: string, perms: Set<string>) {
  cache.set(userId, { perms, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidatePermCache(userId: string) {
  cache.delete(userId);
}

// ─── Core resolver ────────────────────────────────────────────────────────────

/**
 * Returns the effective permission set for a user.
 * = role defaults  +  explicit grants  -  explicit revokes
 */
export async function resolvePermissions(
  userId: string,
  role:   string,
): Promise<Set<string>> {
  const cached = fromCache(userId);
  if (cached) return cached;

  // Start with role defaults
  const effective = defaultsForRole(role);

  // Apply per-user overrides from DB
  const overrides = await prisma.userPermission.findMany({ where: { userId } });

  for (const o of overrides) {
    if (o.granted) effective.add(o.key);
    else            effective.delete(o.key);
  }

  toCache(userId, effective);
  return effective;
}

// ─── Admin CRUD ───────────────────────────────────────────────────────────────

export async function getUserPermissions(userId: string, role: string) {
  const effective = await resolvePermissions(userId, role);
  const overrides = await prisma.userPermission.findMany({ where: { userId } });
  const overrideMap: Record<string, boolean> = {};
  for (const o of overrides) overrideMap[o.key] = o.granted;

  return ALL_PERMISSIONS.map((key) => ({
    key,
    effective:  effective.has(key),
    override:   overrideMap[key] ?? null,   // null = inherited from role
    fromRole:   defaultsForRole(role).has(key),
  }));
}

export async function setPermission(
  userId:  string,
  key:     string,
  granted: boolean,
) {
  if (!ALL_PERMISSIONS.includes(key as PermissionKey)) {
    throw new Error(`Unknown permission key: ${key}`);
  }

  const result = await prisma.userPermission.upsert({
    where:  { userId_key: { userId, key } },
    create: { userId, key, granted },
    update: { granted },
  });

  invalidatePermCache(userId);
  return result;
}

export async function revokePermissionOverride(userId: string, key: string) {
  await prisma.userPermission.deleteMany({ where: { userId, key } });
  invalidatePermCache(userId);
}

export async function resetUserPermissions(userId: string) {
  await prisma.userPermission.deleteMany({ where: { userId } });
  invalidatePermCache(userId);
}

/** Bulk upsert — accepts array of { key, granted } */
export async function bulkSetPermissions(
  userId: string,
  entries: { key: string; granted: boolean }[],
) {
  for (const e of entries) {
    if (!ALL_PERMISSIONS.includes(e.key as PermissionKey)) continue;
    await prisma.userPermission.upsert({
      where:  { userId_key: { userId, key: e.key } },
      create: { userId, key: e.key, granted: e.granted },
      update: { granted: e.granted },
    });
  }
  invalidatePermCache(userId);
}
