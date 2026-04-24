import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../common/middleware/authEnhanced';
import { csvUpload, importCsv, exportCsv, downloadTemplate } from './csv.controller';
import { AuthRequest } from '../../common/middleware/auth.middleware';

const router = Router();
router.use(authenticate);

// Upload middleware wrapper (handles multer errors gracefully)
function upload(req: Request, res: Response, next: NextFunction) {
  csvUpload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}

// ── Import: POST /api/csv/import/:entity ──────────────────────────────────────
router.post('/import/:entity', upload, importCsv as any);

// ── Export: GET  /api/csv/export/:entity ──────────────────────────────────────
router.get('/export/:entity', exportCsv as any);

// ── Template: GET /api/csv/template/:entity ───────────────────────────────────
router.get('/template/:entity', downloadTemplate as any);

export default router;
