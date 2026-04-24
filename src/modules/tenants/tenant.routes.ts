import { Router, Request, Response } from 'express';
import { TenantController } from './tenant.controller';
import { validate, schemas } from '../../common/middleware/validation.middleware';
import { PrismaClient } from '@prisma/client';

const router = Router();
const tenantController = new TenantController();
const prisma = new PrismaClient();

interface AuthReq extends Request {
  user?: { userId: string; tenantId: string; role: string; email: string };
}

// GET /api/tenants/lifecycle — returns current tenant lifecycle status for banners
router.get('/lifecycle', async (req: AuthReq, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, trialEndsAt: true, suspendedAt: true },
    });

    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

    return res.json({ success: true, data: tenant });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/', (req, res) => tenantController.getAll(req, res));
router.get('/:id', (req, res) => tenantController.getById(req, res));
router.post('/', validate(schemas.createTenant), (req, res) => tenantController.create(req, res));
router.put('/:id', (req, res) => tenantController.update(req, res));
router.delete('/:id', (req, res) => tenantController.delete(req, res));

export default router;
