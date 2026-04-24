import { Request, Response, NextFunction } from 'express';

interface ValidationRule {
  field: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  email?: boolean;
  url?: boolean;
  numeric?: boolean;
  min?: number;
  max?: number;
  custom?: (value: any) => boolean | string;
}

interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  value: any;
}

interface ValidationSchema {
  [key: string]: ValidationRule[];
}

export class InputValidator {
  private static schemas: Map<string, ValidationSchema> = new Map();

  static defineSchema(name: string, schema: ValidationSchema): void {
    this.schemas.set(name, schema);
  }

  static validate(req: Request, res: Response, next: NextFunction, schemaName?: string) => {
    try {
      const data = req.body;
      
      // Use provided schema or get from request path
      const validationSchema = schemaName ? this.schemas.get(schemaName) : null;
      
      if (validationSchema) {
        const result = this.validateData(data, validationSchema);
        
        if (!result.isValid) {
          return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: result.errors
          });
        }
        
        // Attach validated data to request
        (req as any).validatedData = result.value;
      }
      
      next();
    } catch (error) {
      console.error('Validation error:', error);
      return res.status(500).json({
        success: false,
        error: 'Validation error'
      });
    }
  };

  static validateData(data: any, schema: ValidationSchema): ValidationResult {
    const errors: Record<string, string> = {};
    let isValid = true;
    const value: any = {};

    for (const [field, rules] of Object.entries(schema)) {
      const fieldValue = this.getValue(data, field);
      value[field] = fieldValue;
      
      for (const rule of rules) {
        const error = this.validateRule(fieldValue, rule);
        
        if (error) {
          errors[field] = error;
          isValid = false;
        }
      }
    }

    return { isValid, errors, value };
  }

  private static validateRule(value: any, rule: ValidationRule): string | null {
    const { field, required, minLength, maxLength, pattern, email, url, numeric, min, max, custom } = rule;
    
    // Check required
    if (required && (value === null || value === undefined || value === '')) {
      return `${field} alanı zorunludur`;
    }
    
    // Check type
    if (numeric && value !== null && value !== undefined) {
      const num = Number(value);
      if (isNaN(num)) {
        return `${field} sayısal olmalıdır`;
      }
    }
    
    // Check string
    if (typeof value === 'string' && value !== null && value !== undefined) {
      // Trim whitespace
      const trimmedValue = value.trim();
      
      if (minLength && trimmedValue.length < minLength) {
        return `${field} en az ${minLength} karakter olmalıdır`;
      }
      
      if (maxLength && trimmedValue.length > maxLength) {
        return `${field} en fazla ${maxLength} karakter olabilir`;
      }
    }
    
    // Check email
    if (email && value !== null && value !== undefined) {
      const emailRegex = /^[^\s*[^@\s]+@[^@\s]+\s*$/;
      if (!emailRegex.test(value)) {
        return `${field} geçerli bir e-posta adresi olmalıdır`;
      }
    }
    
    // Check URL
    if (url && value !== null && value !== undefined) {
      try {
        new URL(value);
      } catch {
        return `${field} geçerli bir URL olmalıdır`;
      }
    }
    
    // Check numeric range
    if (numeric && value !== null && value !== undefined) {
      const num = Number(value);
      if (min !== undefined && num < min) {
        return `${field} en az ${min} olmalıdır`;
      }
      if (max !== undefined && num > max) {
        return `${field} en fazla ${max} olmalıdır`;
      }
    }
    
    // Custom validation
    if (custom && value !== null && value !== undefined) {
      const result = custom(value);
      if (result !== true) {
        return typeof result === 'string' ? result : `${field} geçersiz`;
      }
    }
    
    return null;
  }

  private static getValue(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }
    
    return current;
  }

  // Predefined validation schemas
  static schemas = {
    user: {
      email: {
        required: true,
        email: true,
        maxLength: 100
      },
      firstName: {
        required: true,
        minLength: 2,
        maxLength: 50
      },
      lastName: {
        required: true,
        minLength: 2,
        maxLength: 50
      },
      password: {
        required: true,
        minLength: 8,
        maxLength: 100
      },
      role: {
        required: true,
        enum: ['USER', 'ADMIN', 'MANAGER']
      }
    },
    
    login: {
      email: {
        required: true,
        email: true
      },
      password: {
        required: true,
        minLength: 8
      }
    },
    
    product: {
      name: {
        required: true,
        minLength: 3,
        maxLength: 100
      },
      description: {
        maxLength: 1000
      },
      price: {
        required: true,
        numeric: true,
        min: 0
      },
      category: {
        required: true
      }
    },
    
    ticket: {
      subject: {
        required: true,
        minLength: 5,
        maxLength: 200
      },
      description: {
        required: true,
        minLength: 10,
        maxLength: 1000
      },
      priority: {
        required: true,
        enum: ['low', 'medium', 'high', 'urgent']
      },
      category: {
        required: true,
        enum: ['technical', 'billing', 'feature_request', 'bug_report', 'other']
      }
    },
    
    supportMessage: {
      content: {
        required: true,
        minLength: 10,
        maxLength: 2000
      }
    }
  };

  // Validation middleware factory
  static validateBody = (schemaName: string) => {
    return (req: Request, res: Response, next: NextFunction) => {
      this.validate(req, res, next, schemaName);
    };
  };

  // Custom validation rules
  static validatePassword = (password: string): boolean => {
    // At least 8 characters
    if (password.length < 8) return false;
    
    // At least one uppercase letter
    if (!/[A-Z]/.test(password)) return false;
    
    // At least one lowercase letter
    if (!/[a-z]/.test(password)) return false;
    
    // At least one number
    if (!/\d/.test(password)) return false;
    
    // At least one special character
    if (!/[!@#$%^&*()_+\-=\[\]{}|\\:"'<>,.<>?/]/.test(password)) {
      return false;
    }
    
    return true;
  };

  static validateEmail = (email: string): boolean {
    const emailRegex = /^[^\s*[^@\s]+@[^@\s]+\s*$/;
    return emailRegex.test(email);
  };

  static validatePhone = (phone: string): boolean => {
    // Turkish phone number format
    const phoneRegex = /^(\+90|053\d{8}|053\d{8}|054\d{8}|055\d{8}|053\d{9}|054\d{9}|053\d{9}|053\d{7}|054\d{7}|055\d{7})\d{8}$/;
    return phoneRegex.test(phone);
  };

  static sanitizeInput(input: string): string {
    if (!input) return '';
    
    // Remove potentially dangerous characters
    return input
      .replace(/[<>]/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+=/gi, '')
      .replace(/eval\(/gi, '')
      .trim();
  };

  static sanitizeHtml = (html: string): string {
    if (!html) return '';
    
    // Basic HTML sanitization
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>) )*[^>]*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>) )*[^>]*<\/iframe>/gi, '')
      .replace(/on\w+=/gi, '')
      .replace(/on\w+=/gi, '')
      .replace(/onerror\s*=/gi, '')
      .replace(/onload\s*=/gi, '');
  };
}

export default InputValidator;
