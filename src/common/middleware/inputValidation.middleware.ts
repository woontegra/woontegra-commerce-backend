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
  custom?: (value: any) => string | null;
}

interface ValidationSchema {
  [key: string]: ValidationRule[];
}

interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  value: any;
}

export class InputValidator {
  static validate(schema: ValidationSchema) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const result = this.validateData(req.body, schema);

      if (result.isValid) {
        req.body = result.value;
        next();
      } else {
        res.status(400).json({
          success: false,
          errors: result.errors,
          message: 'Validation failed'
        });
      }
    };
  }

  private static validateData(data: any, schema: ValidationSchema): ValidationResult {
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
          break;
        }
      }
    }

    return { isValid, errors, value };
  }

  private static validateRule(value: any, rule: ValidationRule): string | null {
    const { field, required, minLength, maxLength, pattern, email, numeric, min, max, custom } = rule;

    if (required && (value === null || value === undefined || value === '')) {
      return `${field} is required`;
    }

    if (value === null || value === undefined) return null;

    const strValue = String(value);

    if (minLength && strValue.length < minLength) {
      return `${field} must be at least ${minLength} characters`;
    }

    if (maxLength && strValue.length > maxLength) {
      return `${field} must be at most ${maxLength} characters`;
    }

    if (pattern && !pattern.test(strValue)) {
      return `${field} format is invalid`;
    }

    if (email && !this.isValidEmail(strValue)) {
      return `${field} must be a valid email`;
    }

    if (numeric && isNaN(Number(value))) {
      return `${field} must be a number`;
    }

    if (min !== undefined && Number(value) < min) {
      return `${field} must be at least ${min}`;
    }

    if (max !== undefined && Number(value) > max) {
      return `${field} must be at most ${max}`;
    }

    if (custom) {
      const customError = custom(value);
      if (customError) return customError;
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

  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Predefined validation schemas
  static schemas = {
    user: {
      email: [{ field: 'email', required: true, email: true, maxLength: 100 }],
      firstName: [{ field: 'firstName', required: true, minLength: 2, maxLength: 50 }],
      lastName: [{ field: 'lastName', required: true, minLength: 2, maxLength: 50 }],
      password: [{ field: 'password', required: true, minLength: 8, maxLength: 100 }],
    },
    login: {
      email: [{ field: 'email', required: true, email: true }],
      password: [{ field: 'password', required: true, minLength: 8 }],
    },
    product: {
      name: [{ field: 'name', required: true, minLength: 3, maxLength: 100 }],
      description: [{ field: 'description', maxLength: 1000 }],
      price: [{ field: 'price', required: true, numeric: true, min: 0 }],
      stock: [{ field: 'stock', required: true, numeric: true, min: 0 }],
    },
  };

  static validateBody(schemaName: keyof typeof this.schemas) {
    return this.validate(this.schemas[schemaName]);
  }
}

export default InputValidator;
