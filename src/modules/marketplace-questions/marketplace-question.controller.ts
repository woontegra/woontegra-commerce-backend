import { Request, Response } from 'express';
import type {
  MarketplaceQuestionSource,
  MarketplaceQuestionStatus,
  MarketplaceQuestionType,
} from '@prisma/client';
import { marketplaceQuestionService } from './marketplace-question.service';

function tid(req: Request): string {
  return (req as any).user?.tenantId as string;
}

const VALID_SOURCES = new Set<string>([
  'TRENDYOL', 'HEPSIBURADA', 'N11', 'PAZARAMA', 'WOONTEGRA', 'AMAZON',
]);

const VALID_TYPES = new Set<string>(['PRODUCT_QUESTION', 'ORDER_QUESTION']);

const VALID_STATUSES = new Set<string>([
  'WAITING_ANSWER', 'PENDING_APPROVAL', 'ANSWERED', 'EXPIRED', 'CLOSED',
]);

function parseEnum<T extends string>(
  value: unknown,
  allowed: Set<string>,
): T | undefined {
  if (value == null || value === '') return undefined;
  const norm = String(value).trim().toUpperCase();
  return allowed.has(norm) ? norm as T : undefined;
}

/**
 * GET /api/marketplace-questions
 */
export const listMarketplaceQuestions = async (req: Request, res: Response) => {
  try {
    const tenantId = tid(req);
    const data = await marketplaceQuestionService.list(tenantId, {
      source:    parseEnum<MarketplaceQuestionSource>(req.query.source, VALID_SOURCES),
      type:      parseEnum<MarketplaceQuestionType>(req.query.type, VALID_TYPES),
      status:    parseEnum<MarketplaceQuestionStatus>(req.query.status, VALID_STATUSES),
      search:    req.query.search != null ? String(req.query.search) : undefined,
      page:      req.query.page  != null ? Number(req.query.page)  : undefined,
      limit:     req.query.limit != null ? Number(req.query.limit) : undefined,
      startDate: req.query.startDate != null ? String(req.query.startDate) : undefined,
      endDate:   req.query.endDate   != null ? String(req.query.endDate)   : undefined,
    });

    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.statusCode ?? 500;
    res.status(status).json({ success: false, error: err.message ?? 'Sorular listelenemedi.' });
  }
};

/**
 * GET /api/marketplace-questions/stats
 */
export const getMarketplaceQuestionStats = async (req: Request, res: Response) => {
  try {
    const tenantId = tid(req);
    const source   = parseEnum<MarketplaceQuestionSource>(req.query.source ?? 'TRENDYOL', VALID_SOURCES)
      ?? 'TRENDYOL';

    const data = await marketplaceQuestionService.getStats(tenantId, source);
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.statusCode ?? 500;
    res.status(status).json({ success: false, error: err.message ?? 'İstatistikler alınamadı.' });
  }
};

/**
 * GET /api/marketplace-questions/:id
 */
export const getMarketplaceQuestion = async (req: Request, res: Response) => {
  try {
    const tenantId = tid(req);
    const id       = String(req.params.id ?? '');
    const data     = await marketplaceQuestionService.getById(tenantId, id);
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.statusCode ?? 500;
    res.status(status).json({ success: false, error: err.message ?? 'Soru bulunamadı.' });
  }
};

/**
 * POST /api/marketplace-questions/sync
 */
export const syncMarketplaceQuestions = async (req: Request, res: Response) => {
  try {
    const tenantId = tid(req);
    const source   = parseEnum<MarketplaceQuestionSource>(req.body?.source ?? 'TRENDYOL', VALID_SOURCES)
      ?? 'TRENDYOL';

    const data = await marketplaceQuestionService.sync(tenantId, { source });
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.statusCode ?? 500;
    res.status(status).json({ success: false, error: err.message ?? 'Sorular senkronize edilemedi.' });
  }
};

/**
 * POST /api/marketplace-questions/:id/answer
 */
export const answerMarketplaceQuestion = async (req: Request, res: Response) => {
  try {
    const tenantId = tid(req);
    const id       = String(req.params.id ?? '');
    const { text } = req.body ?? {};

    const data = await marketplaceQuestionService.answer(tenantId, id, { text });

    res.json({
      success: true,
      message: 'Cevap Trendyol\'a gönderildi. Onay süreci bekleniyor.',
      data,
    });
  } catch (err: any) {
    const status = err.statusCode ?? 500;
    res.status(status).json({ success: false, error: err.message ?? 'Cevap gönderilemedi.' });
  }
};
