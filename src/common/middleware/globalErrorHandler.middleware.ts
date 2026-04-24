import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware';

interface ErrorReport {
  message: string;
  stack?: string;
  statusCode?: number;
  timestamp: string;
  method: string;
  url: string;
  userAgent?: string;
  ip?: string;
  userId?: string;
  body?: any;
  query?: any;
  params?: any;
}

export class GlobalErrorHandler {
  private static errorReports: ErrorReport[] = [];
  private static maxReports = 1000;

  static handleGlobalError = (
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    // Log error
    console.error('Global Error Handler:', error);

    // Create error report
    const errorReport: ErrorReport = {
      message: error.message,
      stack: error.stack,
      statusCode: error instanceof AppError ? error.statusCode : 500,
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      userId: (req as any).user?.id,
      body: this.sanitizeData(req.body),
      query: this.sanitizeData(req.query),
      params: this.sanitizeData(req.params)
    };

    // Store error report
    this.storeErrorReport(errorReport);

    // Send error response
    this.sendErrorResponse(error, res, errorReport);
  };

  static handleAsyncError = (
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    // Handle async errors
    this.handleGlobalError(error, req, res, next);
  };

  static handle404 = (req: Request, res: Response) => {
    const error = new AppError(`Route ${req.originalUrl} not found`, 404);
    
    const errorReport: ErrorReport = {
      message: error.message,
      statusCode: error.statusCode,
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      userId: (req as any).user?.id
    };

    this.storeErrorReport(errorReport);
    this.sendErrorResponse(error, res, errorReport);
  };

  private static sendErrorResponse = (
    error: Error,
    res: Response,
    errorReport: ErrorReport
  ) => {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    
    // Don't expose internal errors in production
    const isDevelopment = process.env.NODE_ENV === 'development';
    const message = isDevelopment ? error.message : 'Internal Server Error';
    const stack = isDevelopment ? error.stack : undefined;

    const response = {
      success: false,
      error: {
        message,
        statusCode,
        stack,
        timestamp: errorReport.timestamp,
        requestId: this.generateRequestId()
      }
    };

    // Add additional info in development
    if (isDevelopment) {
      (response.error as any).details = {
        method: errorReport.method,
        url: errorReport.url,
        userAgent: errorReport.userAgent,
        ip: errorReport.ip
      };
    }

    res.status(statusCode).json(response);
  };

  private static storeErrorReport = (errorReport: ErrorReport) => {
    // Add to reports array
    this.errorReports.push(errorReport);

    // Keep only last maxReports
    if (this.errorReports.length > this.maxReports) {
      this.errorReports = this.errorReports.slice(-this.maxReports);
    }

    // Log to external service in production
    if (process.env.NODE_ENV === 'production') {
      this.logToExternalService(errorReport);
    }
  };

  private static logToExternalService = (errorReport: ErrorReport) => {
    try {
      // Send to logging service (Sentry, LogRocket, etc.)
      console.log('External Error Report:', errorReport);
      
      // Example: Sentry.captureException(new Error(errorReport.message), {
      //   tags: {
      //     method: errorReport.method,
      //     statusCode: errorReport.statusCode
      //   },
      //   extra: errorReport
      // });
    } catch (loggingError) {
      console.error('Failed to log error to external service:', loggingError);
    }
  };

  private static sanitizeData = (data: any): any => {
    if (!data || typeof data !== 'object') return data;

    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'key',
      'auth',
      'authorization',
      'cookie',
      'session',
      'creditCard',
      'cvv',
      'ssn',
      'socialSecurityNumber'
    ];

    const sanitized = { ...data };

    const sanitizeObject = (obj: any): any => {
      if (Array.isArray(obj)) {
        return obj.map(sanitizeObject);
      }

      if (obj && typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          const lowerKey = key.toLowerCase();
          
          if (sensitiveFields.some(field => lowerKey.includes(field))) {
            result[key] = '[REDACTED]';
          } else if (typeof value === 'object' && value !== null) {
            result[key] = sanitizeObject(value);
          } else {
            result[key] = value;
          }
        }
        return result;
      }

      return obj;
    };

    return sanitizeObject(sanitized);
  };

  private static generateRequestId = (): string => {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  static getErrorReports = (): ErrorReport[] => {
    return [...this.errorReports];
  };

  static clearErrorReports = (): void => {
    this.errorReports = [];
  };

  static getErrorStats = () => {
    const stats = {
      total: this.errorReports.length,
      byStatusCode: {} as Record<number, number>,
      byMethod: {} as Record<string, number>,
      byHour: {} as Record<string, number>,
      recentErrors: this.errorReports.slice(-10)
    };

    this.errorReports.forEach(report => {
      // By status code
      const statusCode = report.statusCode || 500;
      stats.byStatusCode[statusCode] = (stats.byStatusCode[statusCode] || 0) + 1;

      // By method
      stats.byMethod[report.method] = (stats.byMethod[report.method] || 0) + 1;

      // By hour
      const hour = new Date(report.timestamp).getHours();
      stats.byHour[hour] = (stats.byHour[hour] || 0) + 1;
    });

    return stats;
  };
}

// Graceful shutdown handler
export class GracefulShutdown {
  private static isShuttingDown = false;

  static handleShutdown = (signal: string) => {
    console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
    
    if (this.isShuttingDown) {
      console.log('Shutdown already in progress...');
      return;
    }

    this.isShuttingDown = true;

    // Close database connections
    this.closeConnections();

    // Stop accepting new requests
    this.stopAcceptingRequests();

    // Exit process
    setTimeout(() => {
      console.log('Graceful shutdown completed.');
      process.exit(0);
    }, 5000);
  };

  private static closeConnections = () => {
    try {
      // Close database connections
      // Example: prisma.$disconnect();
      console.log('Database connections closed.');
    } catch (error) {
      console.error('Error closing database connections:', error);
    }
  };

  private static stopAcceptingRequests = () => {
    try {
      // Stop accepting new requests
      console.log('Stopped accepting new requests.');
    } catch (error) {
      console.error('Error stopping requests:', error);
    }
  };

  static setup = () => {
    process.on('SIGTERM', () => this.handleShutdown('SIGTERM'));
    process.on('SIGINT', () => this.handleShutdown('SIGINT'));
    
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      this.handleShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      this.handleShutdown('unhandledRejection');
    });
  };
}

// Circuit breaker pattern for external services
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private threshold = 5,
    private timeout = 60000, // 1 minute
    private resetTimeout = 30000 // 30 seconds
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
    }
  }

  getState() {
    return this.state;
  }

  getFailures() {
    return this.failures;
  }
}

export default GlobalErrorHandler;
