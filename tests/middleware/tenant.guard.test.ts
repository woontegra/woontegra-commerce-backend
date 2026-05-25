import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const prismaMock = vi.hoisted(() => ({
  tenant: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
}));

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  return {
    ...actual,
    PrismaClient: vi.fn(function PrismaClientMock() {
      return prismaMock;
    }),
  };
});

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requireTenantAccess } from '../../src/common/middleware/authEnhanced';

function mockRes() {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = vi.fn().mockImplementation((body: unknown) => {
    res.body = body;
    return res as Response;
  });
  return res as Response;
}

describe('requireTenantAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tenantId yoksa 401', async () => {
    const req = { user: { userId: 'u1' } } as Request;
    const res = mockRes();
    const next = vi.fn();

    await requireTenantAccess(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('aktif tenant varsa next()', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue({ id: 't1', isActive: true });

    const req = { user: { userId: 'u1', tenantId: 't1' } } as Request;
    const res = mockRes();
    const next = vi.fn();

    await requireTenantAccess(req, res, next as NextFunction);

    expect(prismaMock.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 't1', isActive: true },
    });
    expect(next).toHaveBeenCalled();
  });

  it('tenant yok/pasif → 403', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null);

    const req = { user: { userId: 'u1', tenantId: 't1' } } as Request;
    const res = mockRes();
    const next = vi.fn();

    await requireTenantAccess(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
