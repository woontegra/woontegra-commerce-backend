import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { logger } from '../../config/logger';
import { buildDefaultListRows } from './email-template.db';
import {
  EmailTemplateService,
  getTemplateMeta,
} from './email-template.service';

const svc = new EmailTemplateService();

export async function listEmailTemplates(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const templates = await svc.listForTenant(tenantId);
    res.json({ success: true, templates, meta: getTemplateMeta() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Şablonlar alınamadı.';
    logger.warn({ message: '[EmailTemplate] list failed, returning defaults', error: msg });
    res.json({
      success: true,
      templates: buildDefaultListRows().map((r) => ({
        id:         r.id,
        key:        r.key,
        name:       r.name,
        subject:    r.subject,
        preheader:  r.preheader,
        isActive:   r.isActive,
        isSystem:   r.isSystem,
        canDelete:  false,
        updatedAt:  r.updatedAt,
      })),
      meta: getTemplateMeta(),
    });
  }
}

export async function createEmailTemplate(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const template = await svc.createCustom(tenantId, req.body ?? {});
    res.status(201).json({ success: true, template });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Şablon oluşturulamadı.';
    const status =
      msg.includes('zorunlu') || msg.includes('Geçersiz') || msg.includes('kullanılıyor')
        ? 422
        : 500;
    res.status(status).json({ success: false, error: msg });
  }
}

export async function getEmailTemplate(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const key = decodeURIComponent(req.params.key);
    const template = await svc.getByKey(tenantId, key);
    if (!template) {
      res.status(404).json({ success: false, error: 'Şablon bulunamadı.' });
      return;
    }
    res.json({ success: true, template, meta: getTemplateMeta() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Şablon alınamadı.';
    res.status(500).json({ success: false, error: msg });
  }
}

export async function updateEmailTemplate(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const key = decodeURIComponent(req.params.key);
    const template = await svc.update(tenantId, key, req.body ?? {});
    res.json({ success: true, template });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Şablon kaydedilemedi.';
    const status =
      msg.includes('zorunlu') || msg.includes('Geçersiz') || msg.includes('bulunamadı')
        ? 422
        : 500;
    res.status(status).json({ success: false, error: msg });
  }
}

export async function deleteEmailTemplate(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const key = decodeURIComponent(req.params.key);
    await svc.deleteCustom(tenantId, key);
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Şablon silinemedi.';
    const status =
      msg.includes('silinemez') || msg.includes('bulunamadı') ? 422 : 500;
    res.status(status).json({ success: false, error: msg });
  }
}
