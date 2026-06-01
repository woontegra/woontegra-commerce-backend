import path from 'path';
import fs from 'fs';
import multer from 'multer';
import type { Request } from 'express';

export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']);
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
]);

function tenantMediaDir(tenantId: string): string {
  return path.join(process.cwd(), 'uploads', 'media', tenantId);
}

function ensureTenantMediaDir(tenantId: string): string {
  const dir = tenantMediaDir(tenantId);
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
    cb(null, ensureTenantMediaDir(tenantId));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeExt = ALLOWED_EXT.has(ext) ? ext : '.jpg';
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  },
});

export const mediaUploader = multer({
  storage,
  limits: { fileSize: MEDIA_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = ALLOWED_MIME.has(file.mimetype);
    const extOk = ALLOWED_EXT.has(ext);
    if (mimeOk || (file.mimetype === '' && extOk)) {
      cb(null, true);
      return;
    }
    cb(new Error('Bu dosya formatı desteklenmiyor.'));
  },
}).single('file');

export function mediaPublicUrl(tenantId: string, fileName: string): string {
  const base = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${base.replace(/\/$/, '')}/uploads/media/${tenantId}/${fileName}`;
}

export function mediaLocalPath(tenantId: string, fileName: string): string {
  return path.join(tenantMediaDir(tenantId), fileName);
}
