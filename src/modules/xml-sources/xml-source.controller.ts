import { Response, Request } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import * as svc from './xml-source.service';
import { toXmlSourcePublic } from './xml-source.dto';

function resolveMapping(body: Record<string, unknown> | undefined): Record<string, string> | undefined {
  const raw = body?.mappingJson ?? body?.mapping;
  if (raw == null || typeof raw !== 'object') return undefined;
  return raw as Record<string, string>;
}

export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId!;
    const items      = await svc.listXmlSources(tenantId);
    res.json({ status: 'success', data: items.map(toXmlSourcePublic) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Liste alınamadı.' });
  }
};

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId!;
    const {
      name,
      url,
      duplicateMode,
      skipZeroStock,
      isActive,
      autoSyncEnabled,
      autoSyncIntervalHours,
      autoSyncAtHour,
      autoSyncAtMinute,
      autoSyncTimezone,
      customTargetLabels,
      customTargets,
    } = req.body ?? {};
    const mapping = resolveMapping(req.body);
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name zorunludur.' });
      return;
    }
    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url zorunludur.' });
      return;
    }
    if (!mapping) {
      res.status(400).json({ error: 'mappingJson veya mapping (JSON nesne) zorunludur.' });
      return;
    }
    const row = await svc.createXmlSource(tenantId, {
      name,
      url,
      mapping,
      customTargetLabels: customTargetLabels as Record<string, string> | undefined,
      customTargets:      customTargets as Array<{ key: string; label: string }> | undefined,
      duplicateMode,
      skipZeroStock,
      isActive,
      autoSyncEnabled,
      autoSyncIntervalHours,
      autoSyncAtHour,
      autoSyncAtMinute,
      autoSyncTimezone,
    });
    res.status(201).json({ status: 'success', data: toXmlSourcePublic(row) });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      res.status(409).json({ error: 'Bu URL bu kiracı için zaten kayıtlı.' });
      return;
    }
    const msg = e?.message ?? 'Kayıt oluşturulamadı.';
    res.status(400).json({ error: msg });
  }
};

export const getOne = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId!;
    const row        = await svc.getXmlSourceById(req.params.id, tenantId);
    if (!row) { res.status(404).json({ error: 'Bulunamadı.' }); return; }
    res.json({ status: 'success', data: toXmlSourcePublic(row) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Kayıt alınamadı.' });
  }
};

/** Cron / harici scheduler — `X-Xml-Cron-Secret` veya `Authorization: Bearer <XML_CRON_SECRET>` */
export const cronSync = async (req: Request, res: Response): Promise<void> => {
  try {
    const secret = process.env.XML_CRON_SECRET?.trim();
    if (!secret) {
      res.status(503).json({ error: 'XML_CRON_SECRET yapılandırılmamış.' });
      return;
    }
    const header =
      (typeof req.headers['x-xml-cron-secret'] === 'string' && req.headers['x-xml-cron-secret']) ||
      (typeof req.headers.authorization === 'string' && req.headers.authorization.replace(/^Bearer\s+/i, '')) ||
      '';
    if (header !== secret) {
      res.status(401).json({ error: 'Yetkisiz cron isteği.' });
      return;
    }
    const systemUserId = typeof req.body?.systemUserId === 'string' ? req.body.systemUserId : '';
    const force =
      req.query.force === '1' ||
      req.query.force === 'true' ||
      req.body?.force === true;
    const result = await svc.syncAllActiveXmlSources({ systemUserId, force });
    res.json({ status: 'success', ...result });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Cron senkron başarısız.' });
  }
};

export const patch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId!;
    const {
      name,
      url,
      duplicateMode,
      skipZeroStock,
      isActive,
      autoSyncEnabled,
      autoSyncIntervalHours,
      autoSyncAtHour,
      autoSyncAtMinute,
      autoSyncTimezone,
      customTargetLabels,
      customTargets,
    } = req.body ?? {};
    const mapping = resolveMapping(req.body);
    const row = await svc.updateXmlSource(req.params.id, tenantId, {
      name,
      url,
      mapping,
      customTargetLabels: customTargetLabels as Record<string, string> | undefined,
      customTargets:      customTargets as Array<{ key: string; label: string }> | undefined,
      duplicateMode,
      skipZeroStock,
      isActive,
      autoSyncEnabled,
      autoSyncIntervalHours,
      autoSyncAtHour,
      autoSyncAtMinute,
      autoSyncTimezone,
    });
    if (!row) { res.status(404).json({ error: 'Bulunamadı.' }); return; }
    res.json({ status: 'success', data: toXmlSourcePublic(row) });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      res.status(409).json({ error: 'Bu URL bu kiracı için zaten kayıtlı.' });
      return;
    }
    res.status(400).json({ error: e?.message ?? 'Güncellenemedi.' });
  }
};

/** Kayıtlı kaynak için alan önizlemesi (mapping korunur, yeni alanlar önerilir) */
export const previewFields = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId!;
    const data = await svc.previewXmlSourceFields(req.params.id, tenantId);
    if (!data) { res.status(404).json({ error: 'Bulunamadı.' }); return; }
    res.json({ status: 'success', data });
  } catch (e: any) {
    const msg = e?.message ?? 'Önizleme başarısız.';
    res.status(msg.includes('indirilemedi') ? 502 : 400).json({ error: msg });
  }
};

export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId!;
    const ok         = await svc.deleteXmlSource(req.params.id, tenantId);
    if (!ok) { res.status(404).json({ error: 'Bulunamadı.' }); return; }
    res.json({ status: 'success' });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Silinemedi.' });
  }
};

export const sync = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId!;
    const userId   = req.user!.userId ?? req.user!.id;
    const out        = await svc.syncXmlSource(req.params.id, tenantId, userId);
    res.json({ status: 'success', summary: out.summary, results: out.results });
  } catch (e: any) {
    const msg = e?.message ?? 'Senkron başarısız.';
    const st  = msg.includes('bulunamadı') || msg.includes('pasif') ? 400 : 502;
    res.status(st).json({ error: msg });
  }
};
