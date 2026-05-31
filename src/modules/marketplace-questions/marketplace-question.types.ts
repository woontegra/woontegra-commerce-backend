import type {
  MarketplaceQuestionSource,
  MarketplaceQuestionStatus,
  MarketplaceQuestionType,
} from '@prisma/client';

export type { MarketplaceQuestionSource, MarketplaceQuestionStatus, MarketplaceQuestionType };

export const MARKETPLACE_QUESTION_SOURCE_LABELS: Record<MarketplaceQuestionSource, string> = {
  TRENDYOL:     'Trendyol',
  HEPSIBURADA:  'Hepsiburada',
  N11:          'N11',
  PAZARAMA:     'Pazarama',
  WOONTEGRA:    'Woontegra',
  AMAZON:       'Amazon',
};

export const MARKETPLACE_QUESTION_TYPE_LABELS: Record<MarketplaceQuestionType, string> = {
  PRODUCT_QUESTION: 'Ürün Sorusu',
  ORDER_QUESTION:   'Sipariş Sorusu',
};

export interface MarketplaceQuestionDTO {
  id:                  string;
  tenantId:            string;
  source:              MarketplaceQuestionSource;
  sourceLabel:         string;
  type:                MarketplaceQuestionType;
  externalQuestionId:  string;
  externalStatus:      string | null;
  status:              MarketplaceQuestionStatus;
  questionText:        string;
  answerText:          string | null;
  customerName:        string | null;
  customerId:          string | null;
  productName:         string | null;
  barcode:             string | null;
  externalProductId:   string | null;
  externalOrderId:       string | null;
  productId:           string | null;
  orderId:             string | null;
  askedAt:             string;
  answeredAt:          string | null;
  lastSyncedAt:        string | null;
  rawPayload?:         unknown;
}

export interface MarketplaceQuestionListQuery {
  source?:   MarketplaceQuestionSource;
  type?:     MarketplaceQuestionType;
  status?:   MarketplaceQuestionStatus;
  search?:   string;
  page?:     number;
  limit?:    number;
  startDate?: string;
  endDate?:   string;
}

export interface MarketplaceQuestionSyncInput {
  source?: MarketplaceQuestionSource;
}

export interface MarketplaceQuestionSyncResult {
  source:       MarketplaceQuestionSource;
  fetched:      number;
  created:      number;
  updated:      number;
  unchanged:    number;
  errors:       number;
}

export interface ExternalQuestionRecord {
  externalQuestionId: string;
  externalStatus:     string | null;
  status:             MarketplaceQuestionStatus;
  type:               MarketplaceQuestionType;
  questionText:       string;
  answerText:         string | null;
  customerName:       string | null;
  customerId:         string | null;
  productName:        string | null;
  barcode:            string | null;
  externalProductId:  string | null;
  externalOrderId:    string | null;
  askedAt:            Date;
  answeredAt:         Date | null;
  rawPayload:         unknown;
}

export interface ExternalQuestionFilter {
  page?:             number;
  size?:             number;
  barcode?:          string;
  startDate?:        number;
  endDate?:          number;
  externalStatus?:   string;
  orderByField?:     string;
  orderByDirection?: 'ASC' | 'DESC';
}

export interface ExternalQuestionListResult {
  items:         ExternalQuestionRecord[];
  page:          number;
  size:          number;
  totalElements: number;
  totalPages:    number;
}

export interface AnswerQuestionInput {
  text: string;
}
