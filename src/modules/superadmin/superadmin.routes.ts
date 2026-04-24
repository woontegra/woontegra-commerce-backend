import { Router } from 'express';
import { superAdminController } from './superadmin.controller';
import { authenticate } from '../../common/middleware/authEnhanced';
import { requireSuperAdmin } from '../../common/middleware/superAdmin';

const router = Router();

// All routes require authentication and super admin role
router.use(authenticate);
router.use(requireSuperAdmin);

// Analytics
router.get('/analytics', superAdminController.getPlatformAnalytics.bind(superAdminController));
router.get('/activity', superAdminController.getRecentActivity.bind(superAdminController));

// Tenant management
router.get('/tenants', superAdminController.getAllTenants.bind(superAdminController));
router.get('/tenants/:tenantId', superAdminController.getTenantDetails.bind(superAdminController));
router.put('/tenants/:tenantId/status', superAdminController.updateTenantStatus.bind(superAdminController));
router.put('/tenants/:tenantId/plan', superAdminController.updateTenantPlan.bind(superAdminController));
router.delete('/tenants/:tenantId', superAdminController.deleteTenant.bind(superAdminController));

export default router;
