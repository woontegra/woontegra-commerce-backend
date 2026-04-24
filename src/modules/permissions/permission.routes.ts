import { Router } from 'express';
import { authenticate } from '../../common/middleware/authEnhanced';
import { requireSuperAdminOrAdmin } from '../../common/middleware/authEnhanced';
import {
  getMyPermissions,
  getUserPermissionList,
  setUserPermission,
  bulkSetUserPermissions,
  deletePermissionOverride,
  resetPermissions,
} from './permission.controller';

const router = Router();
router.use(authenticate);

// ── Current user's permissions (frontend uses this on login) ──────────────────
router.get('/me', getMyPermissions as any);

// ── Admin: manage other users' permissions ────────────────────────────────────
router.get('/:userId',
  requireSuperAdminOrAdmin as any,
  getUserPermissionList as any,
);

router.put('/:userId',
  requireSuperAdminOrAdmin as any,
  bulkSetUserPermissions as any,
);

router.put('/:userId/:key',
  requireSuperAdminOrAdmin as any,
  setUserPermission as any,
);

router.delete('/:userId/:key',
  requireSuperAdminOrAdmin as any,
  deletePermissionOverride as any,
);

router.delete('/:userId',
  requireSuperAdminOrAdmin as any,
  resetPermissions as any,
);

export default router;
