import { Request, Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import {
  parseLayoutBody,
  StorefrontBuilderError,
  storefrontBuilderService,
} from './storefront-builder.service';

function handleError(res: Response, e: unknown, fallback: string): void {
  if (e instanceof StorefrontBuilderError) {
    res.status(e.statusCode).json({ success: false, error: e.message, message: e.message });
    return;
  }
  const msg = e instanceof Error ? e.message : fallback;
  res.status(500).json({ success: false, error: msg, message: msg });
}

export async function getHomeDraft(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const data = await storefrontBuilderService.getHomeDraft(tenantId);
    res.json({ success: true, data });
  } catch (e: unknown) {
    handleError(res, e, 'Taslak layout alınamadı.');
  }
}

export async function saveHomeDraft(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const layout = parseLayoutBody(req.body);
    const data = await storefrontBuilderService.saveHomeDraft(tenantId, layout);
    res.json({
      success: true,
      data,
      message: 'Taslak layout kaydedildi.',
    });
  } catch (e: unknown) {
    handleError(res, e, 'Taslak layout kaydedilemedi.');
  }
}

export async function publishHome(req: AuthRequest, res: Response): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const data = await storefrontBuilderService.publishHome(tenantId);
    res.json({
      success: true,
      data,
      message: 'Ana sayfa layout yayına alındı.',
    });
  } catch (e: unknown) {
    handleError(res, e, 'Layout yayınlanamadı.');
  }
}

export async function getPublicHomeLayout(req: Request, res: Response): Promise<void> {
  try {
    const tenant = typeof req.query.tenant === 'string' ? req.query.tenant : '';
    const result = await storefrontBuilderService.getPublicHomeLayoutBySlug(tenant);

    if (!result.tenant) {
      res.status(404).json({
        status: 'error',
        error: 'Mağaza bulunamadı.',
        layout: null,
      });
      return;
    }

    res.json({
      status: 'success',
      tenant: result.tenant,
      layout: result.layout,
    });
  } catch (e: unknown) {
    if (e instanceof StorefrontBuilderError) {
      res.status(e.statusCode).json({
        status: 'error',
        error: e.message,
        layout: null,
      });
      return;
    }
    res.status(500).json({
      status: 'error',
      error: 'Layout alınamadı.',
      layout: null,
    });
  }
}
