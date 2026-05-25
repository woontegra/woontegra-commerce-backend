import { writeStructured } from './create-winston';
import type { AppModule, ModuleLogger, StructuredLogFields } from './types';

export function createModuleLogger(module: AppModule): ModuleLogger {
  return {
    info(fields: StructuredLogFields) {
      writeStructured('info', module, fields);
    },
    warn(fields: StructuredLogFields) {
      writeStructured('warn', module, fields);
    },
    error(fields: StructuredLogFields & { error?: unknown }) {
      writeStructured('error', module, fields);
    },
  };
}
