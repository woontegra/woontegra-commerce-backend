/**
 * @deprecated `config/logger` veya `common/logging/loggers` kullanın.
 */
export {
  logger,
  stream,
  authLogger,
  billingLogger,
  trendyolLogger,
  xmlLogger,
  appLogger,
  createModuleLogger,
} from '../config/logger';

export const logInfo = (message: string, meta?: Record<string, unknown>) => {
  logger.info({ action: message, message, ...meta });
};

export const logWarn = (message: string, meta?: Record<string, unknown>) => {
  logger.warn({ action: message, message, ...meta });
};

export const logError = (message: string, meta?: Record<string, unknown>) => {
  logger.error({ action: message, message, ...meta });
};

import { authLogger } from '../common/logging/loggers';

export const logAuth = (
  action: string,
  userId: string,
  tenantId: string,
  success: boolean,
  error?: string,
) => {
  const fields = {
    action,
    userId,
    tenantId,
    status: success ? ('success' as const) : ('failure' as const),
    ...(error ? { message: error } : {}),
  };
  if (success) authLogger.info(fields);
  else authLogger.warn(fields);
};
