import { getTraceContext, getTraceId } from './trace-context';
import type { LogLevel, LogStatus } from './types';

export interface NormalizedLogRecord {
  timestamp: string;
  level: LogLevel;
  module: string;
  action: string;
  status: LogStatus;
  traceId: string | null;
  tenantId: string | null;
  userId: string | null;
  message: string;
  stack?: string;
  errorMessage?: string;
  [key: string]: unknown;
}

function inferStatus(level: LogLevel, explicit?: LogStatus): LogStatus {
  if (explicit) return explicit;
  if (level === 'error') return 'failure';
  if (level === 'warn') return 'failure';
  return 'success';
}

function resolveAction(input: Record<string, unknown>): string {
  if (typeof input.action === 'string' && input.action.trim()) return input.action.trim();
  if (typeof input.message === 'string' && input.message.trim()) {
    return input.message.trim().slice(0, 80);
  }
  return 'log';
}

/** Winston info nesnesini standart JSON satırına dönüştürür */
export function normalizeLogRecord(
  level: LogLevel,
  module: string,
  input: Record<string, unknown>,
): NormalizedLogRecord {
  const {
    error,
    stack: inputStack,
    status,
    tenantId,
    userId,
    message,
    action,
    traceId: inputTraceId,
    ...rest
  } = input;

  const traceCtx = getTraceContext();
  const traceId =
    (typeof inputTraceId === 'string' && inputTraceId) ||
    traceCtx?.traceId ||
    getTraceId() ||
    null;

  const resolvedTenantId =
    tenantId != null ? String(tenantId) : (traceCtx?.tenantId != null ? String(traceCtx.tenantId) : null);
  const resolvedUserId =
    userId != null ? String(userId) : (traceCtx?.userId != null ? String(traceCtx.userId) : null);

  let stack = typeof inputStack === 'string' ? inputStack : undefined;
  let errorMessage: string | undefined;

  if (error instanceof Error) {
    stack = error.stack ?? stack;
    errorMessage = error.message;
  } else if (error != null) {
    errorMessage = String(error);
  }

  const resolvedAction = resolveAction({ action, message, ...rest });
  const resolvedMessage =
    (typeof message === 'string' && message) ||
    resolvedAction;

  return {
    timestamp: new Date().toISOString(),
    level,
    module,
    action:    resolvedAction,
    status:    inferStatus(level, status as LogStatus | undefined),
    traceId,
    tenantId:  resolvedTenantId,
    userId:    resolvedUserId,
    message:   resolvedMessage,
    ...(errorMessage ? { errorMessage } : {}),
    ...(stack ? { stack } : {}),
    ...rest,
  };
}
