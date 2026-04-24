// ─── All granular permission keys ─────────────────────────────────────────────
// Format: resource.action
// Wildcard "*" means "all actions on that resource"

export const ALL_PERMISSIONS = [
  // Products
  'product.view',
  'product.create',
  'product.update',
  'product.delete',
  'product.import',
  'product.export',

  // Orders
  'order.view',
  'order.create',
  'order.update',
  'order.delete',
  'order.export',

  // Customers
  'customer.view',
  'customer.create',
  'customer.update',
  'customer.delete',
  'customer.export',

  // Categories
  'category.view',
  'category.create',
  'category.update',
  'category.delete',

  // Reports
  'report.view',

  // Settings
  'settings.view',
  'settings.update',

  // Billing
  'billing.view',
  'billing.manage',

  // Team / Users
  'team.view',
  'team.invite',
  'team.manage',

  // Marketing / Campaigns
  'campaign.view',
  'campaign.create',
  'campaign.update',
  'campaign.delete',

  // Support
  'support.view',
  'support.manage',

  // CSV
  'csv.import',
  'csv.export',
] as const;

export type PermissionKey = (typeof ALL_PERMISSIONS)[number];

// ─── Role defaults (no DB records needed for these) ───────────────────────────

const USER_PERMS: PermissionKey[] = [
  'product.view',
  'order.view',
  'order.create',
  'customer.view',
];

const MANAGER_PERMS: PermissionKey[] = [
  ...USER_PERMS,
  'product.create', 'product.update', 'product.delete', 'product.import', 'product.export',
  'order.update', 'order.delete', 'order.export',
  'customer.create', 'customer.update', 'customer.export',
  'category.view', 'category.create', 'category.update', 'category.delete',
  'report.view',
  'csv.import', 'csv.export',
];

const ADMIN_PERMS: PermissionKey[] = [
  ...MANAGER_PERMS,
  'customer.delete',
  'settings.view', 'settings.update',
  'billing.view',
  'team.view', 'team.invite',
  'campaign.view', 'campaign.create', 'campaign.update', 'campaign.delete',
  'support.view', 'support.manage',
];

// SUPER_ADMIN gets all permissions — we special-case this in the resolver

export const ROLE_DEFAULTS: Record<string, PermissionKey[]> = {
  SUPER_ADMIN: [...ALL_PERMISSIONS],
  ADMIN:       ADMIN_PERMS,
  MANAGER:     MANAGER_PERMS,
  USER:        USER_PERMS,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function defaultsForRole(role: string): Set<PermissionKey> {
  return new Set(ROLE_DEFAULTS[role] ?? []);
}

/** Expand "product.*" shorthand into individual keys */
export function expandWildcard(key: string): PermissionKey[] {
  if (!key.endsWith('.*')) return [];
  const prefix = key.slice(0, -2);
  return ALL_PERMISSIONS.filter((k) => k.startsWith(`${prefix}.`));
}
