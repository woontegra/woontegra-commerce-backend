import { Router } from 'express';
import { DomainController } from './domain.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();
const domainController = new DomainController();

// All routes require authentication
router.use(authenticate);

// Get domain settings
router.get('/settings', domainController.getDomainSettings.bind(domainController));

// Update subdomain
router.put('/subdomain', domainController.updateSubdomain.bind(domainController));

// Custom domain management
router.post('/custom', domainController.addCustomDomain.bind(domainController));
router.post('/verify', domainController.verifyCustomDomain.bind(domainController));
router.delete('/custom', domainController.removeCustomDomain.bind(domainController));

export default router;
