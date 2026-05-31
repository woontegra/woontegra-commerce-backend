import type { MarketplaceQuestionSource } from '@prisma/client';
import type {
  AnswerQuestionInput,
  ExternalQuestionFilter,
  ExternalQuestionListResult,
  ExternalQuestionRecord,
} from '../marketplace-question.types';

export interface MarketplaceQuestionProvider {
  readonly source: MarketplaceQuestionSource;

  getQuestions(tenantId: string, filter?: ExternalQuestionFilter): Promise<ExternalQuestionListResult>;

  getQuestionDetail(tenantId: string, externalQuestionId: string): Promise<ExternalQuestionRecord | null>;

  answerQuestion(
    tenantId: string,
    externalQuestionId: string,
    input: AnswerQuestionInput,
  ): Promise<void>;
}
