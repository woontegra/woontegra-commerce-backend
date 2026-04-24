import { Response } from 'express';
import multer from 'multer';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { importProducts, importCustomers } from './import.service';
import { exportProducts, exportCustomers, exportOrders, productTemplate, customerTemplate } from './export.service';
import { auditService, AuditCategory, AuditAction } from '../audit/audit.service';
import { logger } from '../../config/logger';

// ─── Multer: in-memory, 10 MB max ────────────────────────────────────────────

export const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' ||
        file.mimetype === 'application/vnd.ms-excel' ||
        file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Sadece .csv dosyaları kabul edilir.'));
    }
  },
}).single('file');

// ─── IMPORT ───────────────────────────────────────────────────────────────────

export async function importCsv(req: AuthRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId!;
  const entity   = req.params.entity as 'products' | 'customers';

  if (!req.file) {
    res.status(400).json({ success: false, message: 'CSV dosyası gerekli.' });
    return;
  }

  if (!['products', 'customers'].includes(entity)) {
    res.status(400).json({ success: false, message: 'Geçersiz varlık tipi. products veya customers olmalı.' });
    return;
  }

  try {
    const result = entity === 'products'
      ? await importProducts(req.file.buffer, tenantId)
      : await importCustomers(req.file.buffer, tenantId);

    await auditService.log({
      userId:    req.user!.id,
      userEmail: req.user!.email,
      userRole:  req.user!.role,
      tenantId,
      action:    `CSV_IMPORT_${entity.toUpperCase()}`,
      category:  AuditCategory.GENERAL,
      targetType: entity,
      details:   {
        filename: req.file.originalname,
        total:    result.total,
        created:  result.created,
        updated:  result.updated,
        skipped:  result.skipped,
        errorCount: result.errors.length,
      },
      req,
    });

    const status = result.errors.length > 0 && result.created + result.updated === 0
      ? 422  // all rows failed
      : 200;

    res.status(status).json({ success: status === 200, result });
  } catch (err: any) {
    logger.error({ message: '[CSV] Import error', entity, error: err.message });
    res.status(500).json({ success: false, message: err.message || 'Import başarısız.' });
  }
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────

export async function exportCsv(req: AuthRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId!;
  const entity   = req.params.entity as 'products' | 'customers' | 'orders';

  if (!['products', 'customers', 'orders'].includes(entity)) {
    res.status(400).json({ success: false, message: 'Geçersiz varlık tipi.' });
    return;
  }

  try {
    let csv: string;
    let filename: string;

    if (entity === 'products') {
      csv      = await exportProducts(tenantId);
      filename = `products_${Date.now()}.csv`;
    } else if (entity === 'customers') {
      csv      = await exportCustomers(tenantId);
      filename = `customers_${Date.now()}.csv`;
    } else {
      const from   = req.query.from   ? new Date(req.query.from as string)   : undefined;
      const to     = req.query.to     ? new Date(req.query.to   as string)   : undefined;
      const status = req.query.status as string | undefined;
      csv      = await exportOrders(tenantId, { from, to, status });
      filename = `orders_${Date.now()}.csv`;
    }

    await auditService.log({
      userId: req.user!.id, userEmail: req.user!.email, userRole: req.user!.role,
      tenantId,
      action:    `CSV_EXPORT_${entity.toUpperCase()}`,
      category:  AuditCategory.GENERAL,
      targetType: entity,
      req,
    });

    res.setHeader('Content-Type',        'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err: any) {
    logger.error({ message: '[CSV] Export error', entity, error: err.message });
    res.status(500).json({ success: false, message: err.message || 'Export başarısız.' });
  }
}

// ─── TEMPLATE DOWNLOAD ────────────────────────────────────────────────────────

export async function downloadTemplate(req: AuthRequest, res: Response): Promise<void> {
  const entity = req.params.entity as 'products' | 'customers';

  if (!['products', 'customers'].includes(entity)) {
    res.status(400).json({ success: false, message: 'Şablon: products veya customers olmalı.' });
    return;
  }

  const csv      = entity === 'products' ? productTemplate() : customerTemplate();
  const filename = `${entity}_template.csv`;

  res.setHeader('Content-Type',        'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}
