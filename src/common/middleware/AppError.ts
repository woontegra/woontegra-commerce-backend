export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    Error.captureStackTrace(this, this.constructor);
  }
}

// Predefined error codes for common scenarios
export const ErrorCodes = {
  // Authentication errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  
  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  RESOURCE_LIMIT_EXCEEDED: 'RESOURCE_LIMIT_EXCEEDED',
  
  // Business logic errors
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  
  // System errors
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // Tenant errors
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  TENANT_INACTIVE: 'TENANT_INACTIVE',
  INVALID_TENANT: 'INVALID_TENANT',
} as const;

// Helper functions to create common errors
export const createValidationError = (message: string): AppError => {
  return new AppError(message, 400, ErrorCodes.VALIDATION_ERROR);
};

export const createUnauthorizedError = (message: string = 'Unauthorized'): AppError => {
  return new AppError(message, 401, ErrorCodes.UNAUTHORIZED);
};

export const createForbiddenError = (message: string = 'Forbidden'): AppError => {
  return new AppError(message, 403, ErrorCodes.FORBIDDEN);
};

export const createNotFoundError = (resource: string = 'Resource'): AppError => {
  return new AppError(`${resource} not found`, 404, ErrorCodes.NOT_FOUND);
};

export const createConflictError = (message: string): AppError => {
  return new AppError(message, 409, ErrorCodes.ALREADY_EXISTS);
};

export const createRateLimitError = (): AppError => {
  return new AppError('Rate limit exceeded. Please try again later.', 429, ErrorCodes.RATE_LIMIT_EXCEEDED);
};

export const createSubscriptionError = (message: string): AppError => {
  return new AppError(message, 403, ErrorCodes.SUBSCRIPTION_EXPIRED);
};

export const createPlanLimitError = (feature: string, limit: number): AppError => {
  return new AppError(
    `You have reached the limit for ${feature}. Maximum allowed: ${limit}`,
    403,
    ErrorCodes.PLAN_LIMIT_REACHED
  );
};
