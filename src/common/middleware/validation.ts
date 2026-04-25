import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';
import { createValidationError } from './AppError';

// Validation middleware factory
export const validate = (schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      let data;
      
      switch (source) {
        case 'body':
          data = req.body;
          break;
        case 'query':
          data = req.query;
          break;
        case 'params':
          data = req.params;
          break;
        default:
          data = req.body;
      }

      const validatedData = schema.parse(data);
      
      // Attach validated data to request
      req.validated = req.validated || {};
      req.validated[source] = validatedData;
      
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationErrors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));

        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          errors: validationErrors,
        });
      }
      
      return next(error);
    }
  };
};

// Body validation middleware
export const validateBody = (schema: ZodSchema) => validate(schema, 'body');

// Query validation middleware
export const validateQuery = (schema: ZodSchema) => validate(schema, 'query');

// Params validation middleware
export const validateParams = (schema: ZodSchema) => validate(schema, 'params');

// Common validation schemas
export const commonSchemas = {
  // UUID validation
  uuid: z.string().uuid('Invalid UUID format'),
  
  // Email validation
  email: z.string().email('Invalid email format'),
  
  // Password validation
  password: z.string()
    .min(8, 'Password must be at least 8 characters long')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/\d/, 'Password must contain at least one number')
    .regex(/[@$!%*?&]/, 'Password must contain at least one special character'),
  
  // Name validation
  name: z.string()
    .min(2, 'Name must be at least 2 characters long')
    .max(100, 'Name must be less than 100 characters')
    .regex(/^[a-zA-Z\s]+$/, 'Name can only contain letters and spaces'),
  
  // Pagination validation
  pagination: z.object({
    page: z.coerce.number().min(1, 'Page must be at least 1').default(1),
    limit: z.coerce.number().min(1, 'Limit must be at least 1').max(100, 'Limit must be less than 100').default(20),
  }),
  
  // Date range validation
  dateRange: z.object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  }).refine((data) => {
    if (data.startDate && data.endDate) {
      return data.startDate <= data.endDate;
    }
    return true;
  }, {
    message: 'End date must be after start date',
    path: ['endDate'],
  }),
  
  // Tenant validation
  tenantId: z.string().uuid('Invalid tenant ID format'),
  
  // User validation
  userId: z.string().uuid('Invalid user ID format'),
  
  // Product validation
  productCreate: z.object({
    name: z.string().min(1, 'Product name is required').max(200, 'Product name too long'),
    description: z.string().optional(),
    price: z.number().min(0, 'Price must be positive'),
    categoryId: z.string().uuid('Invalid category ID'),
    stock: z.number().min(0, 'Stock must be non-negative').default(0),
    isActive: z.boolean().default(true),
  }),
  
  // Order validation
  orderCreate: z.object({
    customerId: z.string().uuid('Invalid customer ID'),
    items: z.array(z.object({
      productId: z.string().uuid('Invalid product ID'),
      quantity: z.number().min(1, 'Quantity must be at least 1'),
      price: z.number().min(0, 'Price must be positive'),
    })).min(1, 'At least one item is required'),
  }),
  
  // Registration validation
  register: z.object({
    email: z.string().email('Invalid email format'),
    password: z.string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/\d/, 'Password must contain at least one number')
      .regex(/[@$!%*?&]/, 'Password must contain at least one special character'),
    firstName: z.string().min(2, 'First name must be at least 2 characters').max(50, 'First name too long'),
    lastName: z.string().min(2, 'Last name must be at least 2 characters').max(50, 'Last name too long'),
    tenantSlug: z.string().min(3, 'Tenant slug must be at least 3 characters').max(50, 'Tenant slug too long'),
  }),
  
  // Login validation
  login: z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
    tenantSlug: z.string().min(1, 'Tenant slug is required'),
  }),
  
  // Plan validation
  planChange: z.object({
    planId: z.string().uuid('Invalid plan ID'),
  }),
};

// Custom validation decorators
export const validateTenantAccess = (req: Request, res: Response, next: NextFunction) => {
  const tenantId = (req as any).user?.tenantId;
  
  if (!tenantId) {
    return res.status(401).json({
      success: false,
      message: 'Tenant access required',
      code: 'TENANT_ACCESS_REQUIRED',
    });
  }
  
  return next();
};

// Type extension for Request interface
declare global {
  namespace Express {
    interface Request {
      validated?: {
        body?: any;
        query?: any;
        params?: any;
      };
    }
  }
}
