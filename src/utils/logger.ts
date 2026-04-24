import winston from 'winston';
import path from 'path';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Add colors to winston
winston.addColors(colors);

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}${
      info.stack ? '\n' + info.stack : ''
    }${
      info.traceId ? ' [traceId: ' + info.traceId + ']' : ''
    }${
      info.userId ? ' [userId: ' + info.userId + ']' : ''
    }${
      info.tenantId ? ' [tenantId: ' + info.tenantId + ']' : ''
    }${
      info.path ? ' [path: ' + info.path + ']' : ''
    }${
      info.method ? ' [method: ' + info.method + ']' : ''
    }`
  )
);

// Define which transports to use
const transports = [
  // Console transport
  new winston.transports.Console({
    format,
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  }),
  
  // File transport for errors
  new winston.transports.File({
    filename: path.join(process.cwd(), 'logs', 'error.log'),
    level: 'error',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
  
  // File transport for all logs
  new winston.transports.File({
    filename: path.join(process.cwd(), 'logs', 'combined.log'),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
];

// Create the logger
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  levels,
  format,
  transports,
  exitOnError: false,
});

// Create logs directory if it doesn't exist
import fs from 'fs';
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Helper functions for structured logging
export const logInfo = (message: string, meta?: any) => {
  logger.info(message, meta);
};

export const logWarn = (message: string, meta?: any) => {
  logger.warn(message, meta);
};

export const logError = (message: string, meta?: any) => {
  logger.error(message, meta);
};

export const logHttp = (message: string, meta?: any) => {
  logger.http(message, meta);
};

export const logDebug = (message: string, meta?: any) => {
  logger.debug(message, meta);
};

// Structured logging functions
export const logRequest = (req: any) => {
  logger.info('HTTP Request', {
    method: req.method,
    url: req.url,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    traceId: req.headers['x-request-id'],
    userId: req.user?.id,
    tenantId: req.user?.tenantId,
    timestamp: new Date().toISOString(),
  });
};

export const logResponse = (req: any, res: any, responseTime: number) => {
  logger.info('HTTP Response', {
    method: req.method,
    url: req.url,
    path: req.path,
    statusCode: res.statusCode,
    responseTime: `${responseTime}ms`,
    traceId: req.headers['x-request-id'],
    userId: req.user?.id,
    tenantId: req.user?.tenantId,
    timestamp: new Date().toISOString(),
  });
};

export const logAuth = (action: string, userId: string, tenantId: string, success: boolean, error?: string) => {
  logger.info('Authentication Event', {
    action,
    userId,
    tenantId,
    success,
    error,
    timestamp: new Date().toISOString(),
  });
};

export const logTenant = (action: string, tenantId: string, userId: string, meta?: any) => {
  logger.info('Tenant Event', {
    action,
    tenantId,
    userId,
    ...meta,
    timestamp: new Date().toISOString(),
  });
};

export const logSubscription = (action: string, userId: string, tenantId: string, planId: string, meta?: any) => {
  logger.info('Subscription Event', {
    action,
    userId,
    tenantId,
    planId,
    ...meta,
    timestamp: new Date().toISOString(),
  });
};

export const logSecurity = (event: string, severity: 'low' | 'medium' | 'high' | 'critical', details: any) => {
  logger.warn('Security Event', {
    event,
    severity,
    ...details,
    timestamp: new Date().toISOString(),
  });
};

// Export the main logger
export { logger };
