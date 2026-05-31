import prisma from '../../../config/database';
import { decryptTrendyolCredentials } from '../../../common/crypto/marketplace-credential.crypto';
import {
  TrendyolClient,
  type TrendyolQuestionFilter,
} from '../../marketplace/clients/trendyol.client';
import { mapTrendyolQuestionPayload } from '../marketplace-question.mapper';
import type {
  AnswerQuestionInput,
  ExternalQuestionFilter,
  ExternalQuestionListResult,
  ExternalQuestionRecord,
} from '../marketplace-question.types';
import type { MarketplaceQuestionProvider } from './marketplace-question.provider';

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

async function loadTrendyolClient(tenantId: string): Promise<TrendyolClient> {
  const integration = await prisma.trendyolIntegration.findFirst({
    where: { tenantId, isActive: true },
  });
  if (!integration) {
    throw Object.assign(
      new Error('Aktif Trendyol entegrasyonu bulunamadı.'),
      { statusCode: 422 },
    );
  }

  const creds = decryptTrendyolCredentials(integration);
  return new TrendyolClient({
    apiKey:    creds.apiKey,
    apiSecret: creds.apiSecret,
    sellerId:  creds.sellerId,
  });
}

function toTrendyolFilter(filter?: ExternalQuestionFilter): TrendyolQuestionFilter {
  const now = Date.now();
  return {
    page:             filter?.page ?? 0,
    size:             Math.min(filter?.size ?? 50, 50),
    barcode:          filter?.barcode,
    startDate:        filter?.startDate ?? now - TWO_WEEKS_MS,
    endDate:          filter?.endDate ?? now,
    status:           filter?.externalStatus,
    orderByField:     filter?.orderByField ?? 'CreatedDate',
    orderByDirection: filter?.orderByDirection ?? 'DESC',
  };
}

export class TrendyolQuestionProvider implements MarketplaceQuestionProvider {
  readonly source = 'TRENDYOL' as const;

  async getQuestions(tenantId: string, filter?: ExternalQuestionFilter): Promise<ExternalQuestionListResult> {
    const client = await loadTrendyolClient(tenantId);
    const result = await client.getCustomerQuestions(toTrendyolFilter(filter));

    const items = result.content
      .map(mapTrendyolQuestionPayload)
      .filter((r): r is ExternalQuestionRecord => r != null);

    return {
      items,
      page:          result.page,
      size:          result.size,
      totalElements: result.totalElements,
      totalPages:    result.totalPages,
    };
  }

  async getQuestionDetail(tenantId: string, externalQuestionId: string): Promise<ExternalQuestionRecord | null> {
    const client = await loadTrendyolClient(tenantId);
    const raw = await client.getCustomerQuestion(externalQuestionId);
    return mapTrendyolQuestionPayload(raw);
  }

  async answerQuestion(
    tenantId: string,
    externalQuestionId: string,
    input: AnswerQuestionInput,
  ): Promise<void> {
    const client = await loadTrendyolClient(tenantId);
    await client.answerCustomerQuestion(externalQuestionId, input.text);
  }
}

export const trendyolQuestionProvider = new TrendyolQuestionProvider();
