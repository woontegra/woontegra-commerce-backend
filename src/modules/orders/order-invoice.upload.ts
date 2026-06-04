import path from 'path';
import fs from 'fs';
import multer from 'multer';
import type { Request } from 'express';

export const ORDER_INVOICE_PDF_MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_EXT = new Set(['.pdf']);
const ALLOWED_MIME = new Set(['application/pdf']);

function tenantInvoiceDir(tenantId: string): string {
  return path.join(process.cwd(), 'uploads', 'invoices', tenantId);
}

function ensureTenantInvoiceDir(tenantId: string): string {
  const dir = tenantInvoiceDir(tenantId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (req: Request, _file, cb) => {
    const tenantId = (req as Request & { user?: { tenantId?: string } }).user?.tenantId;
    if (!tenantId) {
      cb(new Error('Tenant bilgisi bulunamadı.'), '');
      return;
    }
    cb(null, ensureTenantInvoiceDir(tenantId));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXT.has(ext) ? ext : '.pdf';
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  },
});

export const orderInvoicePdfUploader = multer({
  storage,
  limits: { fileSize: ORDER_INVOICE_PDF_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = ALLOWED_MIME.has(file.mimetype);
    const extOk = ALLOWED_EXT.has(ext);
    if (mimeOk && extOk) {
      cb(null, true);
      return;
    }
    if (file.mimetype === 'application/octet-stream' && extOk) {
      cb(null, true);
      return;
    }
    cb(new Error('Yalnızca PDF dosyası yüklenebilir.'));
  },
}).single('file');

export function orderInvoicePublicUrl(tenantId: string, fileName: string): string {
  const base = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${base.replace(/\/$/, '')}/uploads/invoices/${tenantId}/${fileName}`;
}
