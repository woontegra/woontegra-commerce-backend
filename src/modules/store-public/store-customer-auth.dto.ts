import { z } from 'zod';

export const storeCustomerRegisterSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName:  z.string().min(1).max(100),
  email:     z.string().email().max(200),
  phone:     z.string().min(7).max(30).optional().default(''),
  password:  z.string().min(6).max(128),
});

export const storeCustomerLoginSchema = z.object({
  email:    z.string().email().max(200),
  password: z.string().min(1).max(128),
});

export const storeCustomerForgotPasswordSchema = z.object({
  email: z.string().email().max(200),
});

export const storeCustomerResetPasswordSchema = z.object({
  token:    z.string().min(16).max(256),
  password: z.string().min(6).max(128),
});

export const customerProfileUpdateSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName:  z.string().min(1).max(100),
  phone:     z.string().min(7).max(30),
});

export const customerAddressSchema = z.object({
  title:       z.string().min(1).max(80).optional().default('Adres'),
  fullName:    z.string().min(2).max(200),
  phone:       z.string().min(7).max(30),
  city:        z.string().min(1).max(100),
  district:    z.string().min(1).max(100),
  addressLine: z.string().min(5).max(500),
  postalCode:  z.string().max(20).optional().default(''),
  isDefault:   z.boolean().optional().default(false),
});
