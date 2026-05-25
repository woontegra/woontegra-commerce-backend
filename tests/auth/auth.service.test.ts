import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

const prismaMock = vi.hoisted(() => ({
  tenant: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  product: {
    count: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('../../src/config/database', () => ({
  default: prismaMock,
}));

vi.mock('../../src/modules/audit/audit.service', () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
  AuditAction: { LOGIN: 'LOGIN', REGISTER: 'REGISTER' },
  AuditCategory: { AUTH: 'AUTH' },
}));

vi.mock('../../src/services/tenantUsageLog.service', () => ({
  logTenantUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/tenantDomainSync.service', () => ({
  syncTenantDomainsFromTenant: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/planQuota.service', () => ({
  checkProductLimit: vi.fn().mockResolvedValue(undefined),
}));

import { AuthService } from '../../src/modules/auth/auth.service';
import { AppError } from '../../src/common/middleware/AppError';

describe('AuthService', () => {
  const auth = new AuthService();

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.product.count.mockResolvedValue(0);
  });

  describe('register', () => {
    it('yeni kullanıcı oluşturur ve token döner', async () => {
      prismaMock.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        slug: 'demo',
        isActive: true,
      });
      prismaMock.user.findUnique.mockResolvedValue(null);
      const hashed = await bcrypt.hash('secret123', 10);
      prismaMock.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'OWNER',
        tenantId: 'tenant-1',
        password: hashed,
      });

      const result = await auth.register({
        email: 'test@example.com',
        password: 'secret123',
        firstName: 'Test',
        lastName: 'User',
        tenantSlug: 'demo',
      });

      expect(result.user.email).toBe('test@example.com');
      expect(result.token).toBeTruthy();
      expect(typeof result.token).toBe('string');
    });

    it('mevcut kullanıcıda 409', async () => {
      prismaMock.tenant.findUnique.mockResolvedValue({ id: 't1', isActive: true });
      prismaMock.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        auth.register({
          email: 'a@b.com',
          password: 'x',
          firstName: 'A',
          lastName: 'B',
          tenantSlug: 'demo',
        }),
      ).rejects.toThrow(AppError);
    });
  });

  describe('login', () => {
    it('doğru şifre ile token döner', async () => {
      const hashed = await bcrypt.hash('mypassword', 10);
      prismaMock.tenant.findUnique.mockResolvedValue({ id: 't1', slug: 'shop', isActive: true });
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'user@shop.com',
        password: hashed,
        isActive: true,
        tenantId: 't1',
        firstName: 'U',
        lastName: 'S',
        role: 'OWNER',
        onboardingCompleted: false,
      });

      const result = await auth.login({
        email: 'user@shop.com',
        password: 'mypassword',
        tenantSlug: 'shop',
      });

      expect(result.token).toBeTruthy();
      expect(result.user.tenantId).toBe('t1');
    });

    it('yanlış şifre → 401', async () => {
      const hashed = await bcrypt.hash('correct', 10);
      prismaMock.tenant.findUnique.mockResolvedValue({ id: 't1', isActive: true });
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'user@shop.com',
        password: hashed,
        isActive: true,
        tenantId: 't1',
        role: 'OWNER',
      });

      await expect(
        auth.login({
          email: 'user@shop.com',
          password: 'wrong',
          tenantSlug: 'shop',
        }),
      ).rejects.toMatchObject({ statusCode: 401 });
    });
  });
});
