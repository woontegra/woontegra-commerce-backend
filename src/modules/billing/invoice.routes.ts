import { Router } from 'express';
import { invoiceController } from './invoice.controller';
import { authenticate } from '../../common/middleware/authEnhanced';

const router = Router();

// All routes require authentication and tenant access
router.use(authenticate);

router.get('/', invoiceController.getInvoices.bind(invoiceController));
router.get('/:id', invoiceController.getInvoice.bind(invoiceController));
router.post('/from-order', invoiceController.createInvoiceFromOrder.bind(invoiceController));
router.put('/:id/status', invoiceController.updateInvoiceStatus.bind(invoiceController));
router.get('/:id/pdf', invoiceController.generateInvoicePDF.bind(invoiceController));

export default router;
