import fs from 'fs';
import path from 'path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { dispatchErrorAlert } from './log-alert';
import { persistPlatformLog } from './log-persistence.service';
import { normalizeLogRecord, type NormalizedLogRecord } from './normalize';
import type { LogLevel } from './types';

const logDir = process.env.LOG_DIR || 'logs';

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/** Dosyaya yazılacak JSON satırı */
const fileLineFormat = winston.format.printf((info) => {
  const record = info.normalized as NormalizedLogRecord | undefined;
  if (record) return JSON.stringify(record);
  return JSON.stringify({
    timestamp: info.timestamp,
    level:     info.level,
    message:   info.message,
    ...info,
  });
});

const jsonFileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  fileLineFormat,
);

/** Geliştirme konsolu */
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf((info) => {
    const r = info.normalized as NormalizedLogRecord | undefined;
    if (!r) {
      return `${info.timestamp} [${info.level}]: ${info.message}`;
    }
    const ctx = [
      r.traceId ? `trace=${r.traceId}` : null,
      r.tenantId ? `tenant=${r.tenantId}` : null,
      r.userId ? `user=${r.userId}` : null,
      `action=${r.action}`,
      `status=${r.status}`,
    ]
      .filter(Boolean)
      .join(' ');
    const base = `${info.timestamp} [${info.level}] [${r.module}] ${r.message} | ${ctx}`;
    return r.stack ? `${base}\n${r.stack}` : base;
  }),
);

function consoleEnabled(): boolean {
  if (process.env.LOG_CONSOLE === 'false') return false;
  return true;
}

function fileEnabled(): boolean {
  if (process.env.LOG_FILE === 'false') return false;
  return true;
}

const transports: winston.transport[] = [];

if (fileEnabled()) {
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true,
      format: jsonFileFormat,
    }),
    new DailyRotateFile({
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true,
      format: jsonFileFormat,
    }),
  );
}

if (consoleEnabled()) {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
    }),
  );
}

/** Fallback — en az bir transport */
if (transports.length === 0) {
  transports.push(new winston.transports.Console({ format: consoleFormat }));
}

export const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels: {
    error: 0,
    warn:  1,
    info:  2,
  },
  transports,
});

export function writeStructured(
  level: LogLevel,
  module: string,
  fields: Record<string, unknown>,
): void {
  const normalized = normalizeLogRecord(level, module, fields);
  winstonLogger.log({
    level,
    message: normalized.message,
    normalized,
    ...normalized,
  });

  if (level === 'error') {
    dispatchErrorAlert(normalized);
  }

  void persistPlatformLog(normalized);
}
