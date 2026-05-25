import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../../config/env';
import { createUnauthorizedError } from '../middleware/AppError';

export const STORE_CUSTOMER_TOKEN_KIND = 'store_customer' as const;

export interface StoreCustomerJwtPayload {
  kind:       typeof STORE_CUSTOMER_TOKEN_KIND;
  customerId: string;
  tenantId:   string;
  email:      string;
}

export function generateStoreCustomerToken(
  payload: Omit<StoreCustomerJwtPayload, 'kind'>,
  signOptions?: SignOptions,
): string {
  const options: SignOptions = {
    expiresIn: '30d',
    ...signOptions,
  };
  return jwt.sign(
    { ...payload, kind: STORE_CUSTOMER_TOKEN_KIND },
    config.jwtSecret,
    options,
  );
}

export function verifyStoreCustomerToken(token: string): StoreCustomerJwtPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TokenExpiredError') {
      throw createUnauthorizedError('Oturum süresi doldu');
    }
    throw createUnauthorizedError('Geçersiz oturum');
  }

  if (typeof decoded !== 'object' || decoded === null) {
    throw createUnauthorizedError('Geçersiz oturum');
  }
  const o = decoded as Record<string, unknown>;
  if (o.kind !== STORE_CUSTOMER_TOKEN_KIND) {
    throw createUnauthorizedError('Geçersiz oturum');
  }
  if (typeof o.customerId !== 'string' || typeof o.tenantId !== 'string' || typeof o.email !== 'string') {
    throw createUnauthorizedError('Geçersiz oturum');
  }

  return {
    kind:       STORE_CUSTOMER_TOKEN_KIND,
    customerId: o.customerId,
    tenantId:   o.tenantId,
    email:      o.email,
  };
}
