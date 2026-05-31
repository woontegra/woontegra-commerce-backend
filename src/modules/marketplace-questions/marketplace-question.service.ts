import type { MarketplaceQuestionSource, Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { toMarketplaceQuestionDTO } from './marketplace-question.mapper';
import type {
  MarketplaceQuestionListQuery,
  MarketplaceQuestionSyncInput,
  MarketplaceQuestionSyncResult,
  ExternalQuestionRecord,
} from './marketplace-question.types';
import type { MarketplaceQuestionProvider } from './providers/marketplace-question.provider';
import { trendyolQuestionProvider } from './providers/trendyol-question.provider';

function getProvider(source: MarketplaceQuestionSource): MarketplaceQuestionProvider {
  switch (source) {
    case 'TRENDYOL':
      return trendyolQuestionProvider;
    default:
      throw Object.assign(
        new Error(`Bu kaynak henüz desteklenmiyor: ${source}`),
        { statusCode: 422 },
      );
  }
}

async function resolveProductId(tenantId: string, barcode: string | null | undefined): Promise<string | null> {
  const code = barcode?.trim();
  if (!code) return null;

  const product = await prisma.product.findFirst({
    where: {
      tenantId,
      OR: [
        { barcode: code },
        { sku: code },
      ],
    },
    select: { id: true },
  });
  return product?.id ?? null;
}

function buildListWhere(
  tenantId: string,
  query: MarketplaceQuestionListQuery,
): Prisma.MarketplaceQuestionWhereInput {
  const where: Prisma.MarketplaceQuestionWhereInput = { tenantId };

  if (query.source) where.source = query.source;
  if (query.type)   where.type   = query.type;
  if (query.status) where.status = query.status;

  if (query.startDate || query.endDate) {
    where.askedAt = {};
    if (query.startDate) where.askedAt.gte = new Date(query.startDate);
    if (query.endDate)   where.askedAt.lte = new Date(query.endDate);
  }

  if (query.search?.trim()) {
    const term = query.search.trim();
    where.OR = [
      { questionText:  { contains: term, mode: 'insensitive' } },
      { productName:   { contains: term, mode: 'insensitive' } },
      { customerName:  { contains: term, mode: 'insensitive' } },
      { barcode:       { contains: term, mode: 'insensitive' } },
      { externalOrderId: { contains: term, mode: 'insensitive' } },
    ];
  }

  return where;
}

async function upsertQuestion(
  tenantId: string,
  source: MarketplaceQuestionSource,
  record: ExternalQuestionRecord,
): Promise<'created' | 'updated' | 'unchanged'> {
  const productId = await resolveProductId(tenantId, record.barcode);
  const now = new Date();

  const existing = await prisma.marketplaceQuestion.findUnique({
    where: {
      tenantId_source_externalQuestionId: {
        tenantId,
        source,
        externalQuestionId: record.externalQuestionId,
      },
    },
  });

  const data = {
    type:              record.type,
    externalStatus:    record.externalStatus,
    status:            record.status,
    questionText:      record.questionText,
    answerText:        record.answerText,
    customerName:      record.customerName,
    customerId:        record.customerId,
    productName:       record.productName,
    barcode:           record.barcode,
    externalProductId: record.externalProductId,
    externalOrderId:   record.externalOrderId,
    productId,
    askedAt:           record.askedAt,
    answeredAt:        record.answeredAt,
    lastSyncedAt:      now,
    rawPayload:        record.rawPayload as Prisma.InputJsonValue,
  };

  if (!existing) {
    await prisma.marketplaceQuestion.create({
      data: {
        tenantId,
        source,
        externalQuestionId: record.externalQuestionId,
        ...data,
      },
    });
    return 'created';
  }

  const changed = (
    existing.status !== data.status
    || existing.answerText !== data.answerText
    || existing.externalStatus !== data.externalStatus
    || existing.questionText !== data.questionText
  );

  if (!changed) {
    await prisma.marketplaceQuestion.update({
      where: { id: existing.id },
      data:  { lastSyncedAt: now },
    });
    return 'unchanged';
  }

  await prisma.marketplaceQuestion.update({
    where: { id: existing.id },
    data,
  });
  return 'updated';
}

export class MarketplaceQuestionService {

  async list(tenantId: string, query: MarketplaceQuestionListQuery = {}) {
    const page  = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip  = (page - 1) * limit;
    const where = buildListWhere(tenantId, query);

    const [rows, total] = await Promise.all([
      prisma.marketplaceQuestion.findMany({
        where,
        orderBy: { askedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.marketplaceQuestion.count({ where }),
    ]);

    return {
      items: rows.map(toMarketplaceQuestionDTO),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getById(tenantId: string, id: string) {
    const row = await prisma.marketplaceQuestion.findFirst({
      where: { id, tenantId },
    });
    if (!row) {
      throw Object.assign(new Error('Soru bulunamadı.'), { statusCode: 404 });
    }
    return toMarketplaceQuestionDTO(row);
  }

  async sync(tenantId: string, input: MarketplaceQuestionSyncInput = {}): Promise<MarketplaceQuestionSyncResult> {
    const source = input.source ?? 'TRENDYOL';
    const provider = getProvider(source);

    let page         = 0;
    let totalPages   = 1;
    let fetched      = 0;
    let created      = 0;
    let updated      = 0;
    let unchanged    = 0;
    let errors       = 0;

    while (page < totalPages) {
      let batch;
      try {
        batch = await provider.getQuestions(tenantId, { page, size: 50 });
      } catch (err) {
        throw err;
      }

      totalPages = Math.max(1, batch.totalPages);
      fetched   += batch.items.length;

      for (const item of batch.items) {
        try {
          const outcome = await upsertQuestion(tenantId, source, item);
          if (outcome === 'created')   created++;
          if (outcome === 'updated')   updated++;
          if (outcome === 'unchanged') unchanged++;
        } catch {
          errors++;
        }
      }

      page++;
      if (batch.items.length === 0) break;
    }

    return { source, fetched, created, updated, unchanged, errors };
  }
}

export const marketplaceQuestionService = new MarketplaceQuestionService();
