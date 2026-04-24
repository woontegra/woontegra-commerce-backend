import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import prisma from '../../config/database';
import {
  getUserPermissions,
  setPermission,
  revokePermissionOverride,
  resetUserPermissions,
  bulkSetPermissions,
  resolvePermissions,
} from './permission.service';
import { auditService, AuditCategory } from '../audit/audit.service';

// ─── GET /api/permissions/me ──────────────────────────────────────────────────
// Returns current user's effective permissions (used by frontend on login)

export const getMyPermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const perms = await resolvePermissions(user.id ?? (user as any).userId, user.role);
    res.json({ success: true, data: [...perms] });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/admin/users/:userId/permissions ─────────────────────────────────
// Admin: get full permission breakdown for a user

export const getUserPermissionList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findFirst({
      where:  { id: userId, tenantId: req.user!.tenantId! },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
    if (!user) { res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' }); return; }

    const permissions = await getUserPermissions(userId, user.role);
    res.json({ success: true, data: { user, permissions } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /api/admin/users/:userId/permissions/:key ────────────────────────────
// Admin: set single permission override  (body: { granted: boolean })

export const setUserPermission = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId, key } = req.params;
    const { granted }     = req.body as { granted: boolean };

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId: req.user!.tenantId! },
    });
    if (!user) { res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' }); return; }

    const result = await setPermission(userId, key, granted);

    await auditService.log({
      userId: req.user!.id, userEmail: req.user!.email, userRole: req.user!.role,
      tenantId: req.user!.tenantId!,
      action: granted ? 'PERMISSION_GRANTED' : 'PERMISSION_REVOKED',
      category: AuditCategory.USER,
      targetType: 'User', targetId: userId,
      details: { key, granted }, req,
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.message.startsWith('Unknown') ? 400 : 500)
       .json({ success: false, message: err.message });
  }
};

// ─── PUT /api/admin/users/:userId/permissions (bulk) ─────────────────────────
// Admin: set many permissions at once
// body: { permissions: [{ key, granted }] }

export const bulkSetUserPermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { permissions } = req.body as { permissions: { key: string; granted: boolean }[] };

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId: req.user!.tenantId! },
    });
    if (!user) { res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' }); return; }

    await bulkSetPermissions(userId, permissions ?? []);

    await auditService.log({
      userId: req.user!.id, userEmail: req.user!.email, userRole: req.user!.role,
      tenantId: req.user!.tenantId!,
      action: 'PERMISSIONS_BULK_SET', category: AuditCategory.USER,
      targetType: 'User', targetId: userId,
      details: { count: permissions?.length ?? 0 }, req,
    });

    res.json({ success: true, message: 'İzinler güncellendi.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DELETE /api/admin/users/:userId/permissions/:key ────────────────────────
// Admin: remove override (revert to role default)

export const deletePermissionOverride = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId, key } = req.params;
    await revokePermissionOverride(userId, key);
    res.json({ success: true, message: 'Override kaldırıldı, rol varsayılanına dönüldü.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DELETE /api/admin/users/:userId/permissions ─────────────────────────────
// Admin: reset all overrides → pure role defaults

export const resetPermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    await resetUserPermissions(userId);

    await auditService.log({
      userId: req.user!.id, userEmail: req.user!.email, userRole: req.user!.role,
      tenantId: req.user!.tenantId!,
      action: 'PERMISSIONS_RESET', category: AuditCategory.USER,
      targetType: 'User', targetId: userId, req,
    });

    res.json({ success: true, message: 'Tüm izin overrideları sıfırlandı.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
