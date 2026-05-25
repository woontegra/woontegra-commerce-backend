import path from 'path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { getTraceId } from './trace-context';
import { writeStructured, winstonLogger } from './create-winston';

export type BusinessEventName =
  | 'product_sent'
  | 'xml_sync'
  | 'payment_success'
  | 'subscription_activated';

export interface BusinessEventPayload {
  event:    BusinessEventName;
  tenantId: string;
  metadata: Record<string, unknown>;
  traceId?: string | null;
  timestamp: string;
}

const businessLogDir = process.env.LOG_DIR || 'logs';

let businessTransportAttached = false;

function ensureBusinessTransport(): void {
  if (businessTransportAttached || process.env.LOG_FILE === 'false') return;

  winstonLogger.add(
    new DailyRotateFile({
      filename:      path.join(businessLogDir, 'business-%DATE%.log'),
      datePattern:   'YYYY-MM-DD',
      maxSize:       '20m',
      maxFiles:      '30d',
      zippedArchive: true,
      format: winston.format.combine(
        winston.format((info) => (info.businessEvent ? info : false))(),
        winston.format.printf((info) => JSON.stringify(info.businessEvent)),
      ),
    }),
  );
  businessTransportAttached = true;
}

/**
 * Kritik iş olayları — yapılandırılmış JSON:
 * { event, tenantId, metadata, traceId?, timestamp }
 */
export function logBusinessEvent(
  event: BusinessEventName,
  tenantId: string,
  metadata: Record<string, unknown> = {},
): void {
  const payload: BusinessEventPayload = {
    event,
    tenantId,
    metadata,
    traceId:   getTraceId(),
    timestamp: new Date().toISOString(),
  };

  writeStructured('info', 'business', {
    action:   event,
    status:   'success',
    message:  event,
    tenantId,
    event,
    metadata,
  });

  ensureBusinessTransport();
  winstonLogger.log({
    level:         'info',
    message:       event,
    businessEvent: payload,
  });
}
