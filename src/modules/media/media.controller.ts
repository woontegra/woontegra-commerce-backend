import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { mediaService, MediaError } from './media.service';
import { mediaUploader } from './media.upload';

function handleError(res: Response, e: unknown, fallback: string): void {
  if (e instanceof MediaError) {
    res.status(e.statusCode).json({ success: false, error: e.message, message: e.message });
    return;
  }
  const msg = e instanceof Error ? e.message : fallback;
  res.status(500).json({ success: false, error: msg, message: msg });
}

export async function listMedia(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 200;
    const limit = Number.isFinite(limitRaw) ? limitRaw : 200;
    const data = await mediaService.list(tenantId, limit);
    res.json({ success: true, ...data });
  } catch (e: unknown) {
    handleError(res, e, 'Medya dosyaları yüklenemedi.');
  }
}

export function uploadMedia(req: AuthRequest, res: Response): void {
  mediaUploader(req, res, async (err: unknown) => {
    if (err) {
      const msg =
        err instanceof Error
          ? err.message.includes('File too large')
            ? 'Dosya boyutu çok büyük.'
            : err.message
          : 'Medya yüklenemedi.';
      res.status(400).json({ success: false, error: msg, message: msg });
      return;
    }

    if (!req.file) {
      res.status(400).json({ success: false, error: 'Dosya seçilmedi.', message: 'Dosya seçilmedi.' });
      return;
    }

    try {
      const tenantId = req.user!.tenantId!;
      const asset = await mediaService.createFromUpload(tenantId, req.file);
      res.status(201).json({
        success: true,
        url: asset.url,
        asset,
        message: 'Görsel yüklendi.',
      });
    } catch (e: unknown) {
      handleError(res, e, 'Medya yüklenemedi.');
    }
  });
}

export async function deleteMedia(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const id = req.params.id;
    if (!id?.trim()) {
      res.status(400).json({ success: false, error: 'Geçersiz medya kimliği.', message: 'Geçersiz medya kimliği.' });
      return;
    }
    await mediaService.delete(tenantId, id.trim());
    res.json({ success: true, message: 'Görsel silindi.' });
  } catch (e: unknown) {
    handleError(res, e, 'Görsel silinemedi.');
  }
}
