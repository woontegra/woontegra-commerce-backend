import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';

export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    req.body = value;
    return next();
  };
};

// Common validation schemas
export const schemas = {
  // Auth schemas
  register: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required',
    }),
    password: Joi.string().min(8).required().messages({
      'string.min': 'Password must be at least 8 characters long',
      'any.required': 'Password is required',
    }),
    firstName: Joi.string().min(2).max(50).required().messages({
      'string.min': 'First name must be at least 2 characters long',
      'string.max': 'First name must not exceed 50 characters',
      'any.required': 'First name is required',
    }),
    lastName: Joi.string().min(2).max(50).required().messages({
      'string.min': 'Last name must be at least 2 characters long',
      'string.max': 'Last name must not exceed 50 characters',
      'any.required': 'Last name is required',
    }),
    tenantSlug: Joi.string().required().messages({
      'any.required': 'Tenant slug is required',
    }),
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    tenantSlug: Joi.string().optional().allow(''),
  }),

  // Product schemas
  createProduct: Joi.object({
    name:           Joi.string().min(2).max(200).required(),
    slug:           Joi.string().min(2).max(200).optional(),
    description:    Joi.string().max(200000).allow('', null),
    price:          Joi.number().min(0).default(0),
    sku:            Joi.string().max(100).allow('', null),
    barcode:        Joi.string().max(100).allow('', null),
    unit:           Joi.string().max(50).allow('', null),
    brand:          Joi.string().max(100).allow('', null),
    status:         Joi.string().valid('active', 'draft', 'archived').default('draft'),
    images:         Joi.array().items(Joi.string()).default([]),
    isActive:       Joi.boolean().default(true),
    categoryId:     Joi.string().uuid().allow(null, ''),
    hasVariants:    Joi.boolean().default(false),
    variantOptions: Joi.any(),
    customFields:   Joi.any(),
    // Nested sub-resources (upserted after product creation)
    pricing: Joi.object({
      salePrice:     Joi.number().min(0),
      purchasePrice: Joi.number().min(0).allow(null),
      discountPrice: Joi.number().min(0).allow(null),
      vatRate:       Joi.number().min(0).max(100).default(18),
      currency:      Joi.string().max(10).default('TRY'),
    }).allow(null),
    shipping: Joi.object({
      weight:       Joi.number().min(0).allow(null),
      width:        Joi.number().min(0).allow(null),
      height:       Joi.number().min(0).allow(null),
      length:       Joi.number().min(0).allow(null),
      desi:         Joi.number().min(0).allow(null),
      freeShipping: Joi.boolean().default(false),
      shippingCost: Joi.number().min(0).allow(null),
    }).allow(null),
    stock: Joi.alternatives().try(
      Joi.number().integer().min(0),
      Joi.object({
        quantity: Joi.number().min(0),
        unit:     Joi.string().max(50),
        minStock: Joi.number().min(0).allow(null),
      }),
    ),
  }),

  updateProduct: Joi.object({
    name:           Joi.string().min(1).max(500).allow('', null),
    slug:           Joi.string().max(500).allow('', null),
    description:    Joi.string().max(200000).allow('', null),
    price:          Joi.number().min(0).allow(null),
    basePrice:      Joi.number().min(0).allow(null),
    sku:            Joi.string().max(200).allow('', null),
    barcode:        Joi.string().max(200).allow('', null),
    unit:           Joi.string().max(100).allow('', null),
    brand:          Joi.string().max(200).allow('', null),
    status:         Joi.string().valid('active', 'draft', 'archived').allow('', null),
    images:         Joi.array().items(Joi.alternatives().try(Joi.string(), Joi.object())),
    isActive:       Joi.boolean().allow(null),
    categoryId:     Joi.string().allow(null, ''),
    hasVariants:    Joi.boolean().allow(null),
    variantOptions: Joi.any(),
    customFields:   Joi.any(),
    pricing: Joi.object({
      salePrice:     Joi.number().min(0).allow(null),
      purchasePrice: Joi.number().min(0).allow(null),
      discountPrice: Joi.number().min(0).allow(null),
      vatRate:       Joi.number().min(0).max(100).allow(null),
      currency:      Joi.string().max(10).allow('', null),
    }).allow(null),
    shipping: Joi.object({
      weight:       Joi.number().min(0).allow(null),
      width:        Joi.number().min(0).allow(null),
      height:       Joi.number().min(0).allow(null),
      length:       Joi.number().min(0).allow(null),
      desi:         Joi.number().min(0).allow(null),
      freeShipping: Joi.boolean().allow(null),
      shippingCost: Joi.number().min(0).allow(null),
    }).allow(null),
    stock: Joi.alternatives().try(
      Joi.number().min(0).allow(null),
      Joi.object({
        quantity: Joi.number().min(0).allow(null),
        unit:     Joi.string().max(50).allow('', null),
        minStock: Joi.number().min(0).allow(null),
      }),
    ).allow(null),
  }).min(1),

  // Customer schemas
  createCustomer: Joi.object({
    email: Joi.string().email().required(),
    firstName: Joi.string().min(2).max(50).required(),
    lastName: Joi.string().min(2).max(50).required(),
    phone: Joi.string().max(20).allow('', null),
    address: Joi.string().max(200).allow('', null),
    city: Joi.string().max(100).allow('', null),
    country: Joi.string().max(100).allow('', null),
    zipCode: Joi.string().max(20).allow('', null),
  }),

  // Order schema
  createOrder: Joi.object({
    customerId: Joi.string().uuid().required(),
    notes: Joi.string().max(500).allow('', null),
    items: Joi.array()
      .items(
        Joi.object({
          productId: Joi.string().uuid().required(),
          quantity: Joi.number().integer().min(1).required(),
          price: Joi.number().positive().required(),
        })
      )
      .min(1)
      .required(),
  }),

  // Tenant schemas
  createTenant: Joi.object({
    name: Joi.string().min(3).max(100).required(),
    slug: Joi.string()
      .min(3)
      .max(100)
      .pattern(/^[a-z0-9-]+$/)
      .required()
      .messages({
        'string.pattern.base': 'Slug must contain only lowercase letters, numbers, and hyphens',
      }),
    domain: Joi.string().domain().allow('', null),
  }),
};
