import { AsyncLocalStorage } from 'async_hooks';

export interface TraceContext {
  traceId:  string;
  tenantId?: string | null;
  userId?:   string | null;
}

export const traceStorage = new AsyncLocalStorage<TraceContext>();

export function runWithTrace<T>(ctx: TraceContext, fn: () => T): T {
  return traceStorage.run(ctx, fn);
}

export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

export function getTraceId(): string | null {
  return traceStorage.getStore()?.traceId ?? null;
}

export function enrichTraceContext(partial: Partial<Omit<TraceContext, 'traceId'>>): void {
  const store = traceStorage.getStore();
  if (!store) return;
  if (partial.tenantId !== undefined) store.tenantId = partial.tenantId;
  if (partial.userId !== undefined) store.userId = partial.userId;
}
