/**
 * Merkezi Winston logger — yapılandırılmış JSON (dosya) + okunabilir konsol.
 * Modül logları: common/logging/loggers.ts
 */
import { writeStructured, winstonLogger } from '../common/logging/create-winston';
import { normalizeLogRecord } from '../common/logging/normalize';
import type { LogLevel } from '../common/logging/types';

export {
  authLogger,
  billingLogger,
  trendyolLogger,
  xmlLogger,
  appLogger,
  createModuleLogger,
} from '../common/logging';

type LegacyMeta = Record<string, unknown>;

function logLegacy(level: LogLevel, first: string | LegacyMeta, second?: LegacyMeta): void {
  if (typeof first === 'string') {
    writeStructured(level, 'app', {
      action: first,
      message: first,
      ...(second ?? {}),
    });
    return;
  }
  writeStructured(level, 'app', first);
}

/** Geriye dönük uyumluluk — mevcut logger.info({ message }) çağrıları */
export const logger = {
  info(first: string | LegacyMeta, second?: LegacyMeta) {
    logLegacy('info', first, second);
  },
  warn(first: string | LegacyMeta, second?: LegacyMeta) {
    logLegacy('warn', first, second);
  },
  error(first: string | LegacyMeta, second?: LegacyMeta) {
    logLegacy('error', first, second);
  },
  /** Eski kod — http seviyesi info olarak yazılır */
  http(first: string | LegacyMeta, second?: LegacyMeta) {
    logLegacy('info', first, second);
  },
  debug(first: string | LegacyMeta, second?: LegacyMeta) {
    if ((process.env.LOG_LEVEL || 'info') === 'debug') {
      logLegacy('info', first, second);
    }
  },
  log(level: string, first: string | LegacyMeta, second?: LegacyMeta) {
    const l = level === 'warn' || level === 'error' ? level : 'info';
    logLegacy(l as LogLevel, first, second);
  },
  add: winstonLogger.add.bind(winstonLogger),
};

export const stream = {
  write: (message: string) => {
    const trimmed = message.trim();
    writeStructured('info', 'app', {
      action: 'http_request',
      message: trimmed,
      status: 'success',
    });
  },
};

export { normalizeLogRecord, winstonLogger };
