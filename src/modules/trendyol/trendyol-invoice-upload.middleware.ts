import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { MAX_TRENDYOL_INVOICE_FILE_BYTES } from './trendyol-order-invoice.util';

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_TRENDYOL_INVOICE_FILE_BYTES },
  fileFilter(_req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Sadece PDF dosyası yüklenebilir.'));
      return;
    }
    cb(null, true);
  },
});

const singlePdf = upload.single('file');

/** Trendyol fatura PDF upload — memory only, max 10 MB. */
export function trendyolInvoiceFileUpload(req: Request, res: Response, next: NextFunction) {
  singlePdf(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'Fatura dosyası en fazla 10 MB olabilir.',
        });
      }
      return res.status(400).json({ success: false, error: err.message });
    }
    if (err instanceof Error) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next();
  });
}
