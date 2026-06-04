import { Router } from 'express';
import { NavigationMenuController } from './navigation-menu.controller';
import { authMiddleware } from '../../common/middleware/auth.middleware';
import { tenantMiddleware } from '../../common/middleware/tenant.middleware';

const router = Router();
const ctrl = new NavigationMenuController();

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get('/', ctrl.getMenus);
router.get('/options', ctrl.getOptions);
router.put('/:type', ctrl.saveMenu);

export default router;
