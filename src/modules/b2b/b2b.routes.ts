import { Router } from 'express';
import { B2BController } from './b2b.controller';
import { B2BService } from './b2b.service';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();
const prisma = new PrismaClient();
const b2bService = new B2BService(prisma);
const b2bController = new B2BController(b2bService);

// Apply authentication middleware to all routes
router.use(authenticate);

// Customer Groups
router.get('/customer-groups', b2bController.getCustomerGroups.bind(b2bController));
router.post('/customer-groups', b2bController.createCustomerGroup.bind(b2bController));
router.put('/customer-groups/:id', b2bController.updateCustomerGroup.bind(b2bController));
router.delete('/customer-groups/:id', b2bController.deleteCustomerGroup.bind(b2bController));

// Customer Group Assignment
router.post('/customers/assign-group', b2bController.assignCustomerToGroup.bind(b2bController));
router.get('/customers/by-group/:groupId', b2bController.getCustomersByGroup.bind(b2bController));

// Product Group Pricing
router.put('/products/:variantId/group-pricing', b2bController.updateProductGroupPricing.bind(b2bController));
router.get('/products/:variantId/pricing', b2bController.getProductPricing.bind(b2bController));

export default router;
