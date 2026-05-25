export type LogLevel = 'info' | 'warn' | 'error';

export type LogStatus = 'success' | 'failure' | 'pending' | 'skipped';

/** Standart alanlar — tüm modül loglarında */
export interface StructuredLogFields {
  action: string;
  status?: LogStatus;
  traceId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  message?: string;
  [key: string]: unknown;
}

export interface ModuleLogger {
  info(fields: StructuredLogFields): void;
  warn(fields: StructuredLogFields): void;
  error(fields: StructuredLogFields & { error?: unknown }): void;
}

export type AppModule = 'auth' | 'billing' | 'trendyol' | 'xml' | 'app' | 'business';
