import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

/**
 * Security Middleware Configuration
 */

// Enhanced Helmet configuration
export const securityHelmet = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      scriptSrc: ["'self'", "'unsafe-eval'"], // For development
      connectSrc: ["'self'", "https://api.stripe.com", "https://iyzico.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],
      upgradeInsecureRequests: [],
    },
  },
  // Hide X-Powered-By header
  hidePoweredBy: true,
  // Disable client-side caching
  noSniff: true,
  // Prevent clickjacking
  frameguard: { action: 'deny' },
  // Enable HSTS
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  // X-Content-Type-Options
  xContentTypeOptions: true,
  // Referrer Policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Cross-Origin Embedder Policy
  crossOriginEmbedderPolicy: false, // Disable for now to avoid issues
  // Cross-Origin Resource Policy
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // DNS Prefetch Control
  dnsPrefetchControl: { allow: false },
  // Permissions Policy
  permissionsPolicy: {
    features: {
      camera: ["'none'"],
      microphone: ["'none'"],
      geolocation: ["'none'"],
      payment: ["'none'"],
      usb: ["'none'"],
      magnetometer: ["'none'"],
      gyroscope: ["'none'"],
      accelerometer: ["'none'"],
    },
  },
});

// Rate limiting configurations
export const createRateLimit = (options: {
  windowMs: number;
  max: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
}) => {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: {
      error: options.message || 'Too many requests, please try again later.',
      retryAfter: Math.ceil(options.windowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    handler: (req: Request, res: Response) => {
      logger.warn('[RateLimit] Rate limit exceeded', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        limit: options.max,
        windowMs: options.windowMs,
      });

      res.status(429).json({
        error: options.message || 'Too many requests, please try again later.',
        retryAfter: Math.ceil(options.windowMs / 1000),
      });
    },
  });
};

// Different rate limits for different endpoints
export const rateLimits = {
  // General API rate limit
  general: createRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per 15 minutes
    message: 'Too many requests from this IP, please try again later.',
  }),

  // Strict rate limit for authentication
  auth: createRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per 15 minutes
    message: 'Too many authentication attempts, please try again later.',
  }),

  // Rate limit for password reset
  passwordReset: createRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 attempts per hour
    message: 'Too many password reset attempts, please try again later.',
  }),

  // Rate limit for API key generation
  apiKeyGeneration: createRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 API keys per hour
    message: 'Too many API key generation attempts, please try again later.',
  }),

  // Rate limit for file uploads
  upload: createRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 100, // 100 uploads per hour
    message: 'Too many upload attempts, please try again later.',
  }),

  // Rate limit for marketplace sync
  marketplaceSync: createRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50, // 50 sync operations per hour
    message: 'Too many sync operations, please try again later.',
  }),

  // Rate limit for search
  search: createRateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 searches per minute
    message: 'Too many search requests, please try again later.',
  }),

  // Rate limit for contact forms
  contact: createRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 contact form submissions per hour
    message: 'Too many contact form submissions, please try again later.',
  }),
};

// IP whitelist middleware
export const ipWhitelist = (allowedIPs: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    
    if (!allowedIPs.includes(clientIP as string)) {
      logger.warn('[Security] IP not whitelisted', {
        ip: clientIP,
        userAgent: req.get('User-Agent'),
        path: req.path,
      });

      return res.status(403).json({
        error: 'Access denied',
      });
    }

    next();
  };
};

// Request size limiter
export const requestSizeLimit = (maxSize: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = req.get('Content-Length');
    
    if (contentLength) {
      const sizeInBytes = parseInt(contentLength);
      const maxSizeInBytes = parseSize(maxSize);

      if (sizeInBytes > maxSizeInBytes) {
        logger.warn('[Security] Request size exceeded', {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          path: req.path,
          contentLength: sizeInBytes,
          maxSize: maxSizeInBytes,
        });

        return res.status(413).json({
          error: 'Request entity too large',
          maxSize,
        });
      }
    }

    next();
  };
};

// CORS configuration
export const corsConfig = {
  origin: (origin: string | undefined, callback: Function) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    // In production, check against allowed origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://yourdomain.com',
    ];

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('[Security] CORS violation', {
        origin,
        userAgent: (req: any) => req.get('User-Agent'),
        path: (req: any) => req.path,
      });

      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-Tenant-ID',
  ],
};

// Security headers middleware
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Additional custom security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Remove server information
  res.removeHeader('Server');
  res.removeHeader('X-Powered-By');
  
  next();
};

// Request validation middleware
export const validateRequest = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body);
    
    if (error) {
      logger.warn('[Security] Request validation failed', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        error: error.details,
      });

      return res.status(400).json({
        error: 'Invalid request data',
        details: error.details.map((detail: any) => detail.message),
      });
    }
    
    next();
  };
};

// SQL injection prevention middleware
export const preventSQLInjection = (req: Request, res: Response, next: NextFunction) => {
  const suspiciousPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i,
    /(\b(OR|AND)\s+\d+\s*=\s*\d+)/i,
    /(--|;|\/\*|\*\/)/,
    /(\b(SCRIPT|JAVASCRIPT|VBSCRIPT|ONLOAD|ONERROR)\b)/i,
  ];

  const checkValue = (value: any): boolean => {
    if (typeof value === 'string') {
      return suspiciousPatterns.some(pattern => pattern.test(value));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some(v => checkValue(v));
    }
    return false;
  };

  const { body, query, params } = req;
  
  if (checkValue(body) || checkValue(query) || checkValue(params)) {
    logger.warn('[Security] Suspicious request detected', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method,
      body,
      query,
      params,
    });

    return res.status(400).json({
      error: 'Invalid request detected',
    });
  }

  next();
};

// Helper function to parse size string
function parseSize(size: string): number {
  const units: { [key: string]: number } = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };

  const match = size.toLowerCase().match(/^(\d+)(b|kb|mb|gb)$/);
  if (!match) {
    throw new Error(`Invalid size format: ${size}`);
  }

  const [, value, unit] = match;
  return parseInt(value) * units[unit];
}

// Security audit middleware
export const securityAudit = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  // Log security-relevant requests
  const securityRelevantPaths = [
    '/auth/',
    '/admin/',
    '/api-keys/',
    '/billing/',
    '/marketplace/',
  ];

  const isSecurityRelevant = securityRelevantPaths.some(path => 
    req.path.startsWith(path)
  );

  if (isSecurityRelevant) {
    logger.info('[Security] Security-relevant request', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method,
      tenantId: (req as any).user?.tenantId,
      userId: (req as any).user?.id,
    });
  }

  // Continue with request
  const originalSend = res.send;
  res.send = function(body) {
    const duration = Date.now() - startTime;
    
    if (isSecurityRelevant) {
      logger.info('[Security] Security-relevant response', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        statusCode: res.statusCode,
        duration,
        tenantId: (req as any).user?.tenantId,
        userId: (req as any).user?.id,
      });
    }

    return originalSend.call(this, body);
  };

  next();
};
