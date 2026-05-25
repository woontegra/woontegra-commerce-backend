import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../../config/env';
import { createUnauthorizedError } from '../middleware/AppError';

export interface JwtPayload {
  userId:   string;
  tenantId: string;
  email:    string;
  role:     string;
  isDemo?:  boolean;
  /** Secure tenant impersonation (preferred). */
  isImpersonation?: boolean;
  adminId?:         string;
  /** @deprecated Use isImpersonation + adminId; still verified for older tokens. */
  impersonatedBy?:        string;
  impersonatedByEmail?: string;
}

export const generateToken = (payload: JwtPayload, signOptions?: SignOptions): string => {
  const options: SignOptions = {
    expiresIn: '7d',
    ...signOptions,
  };
  return jwt.sign(payload, config.jwtSecret, options);
};

export const verifyToken = (token: string): JwtPayload => {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TokenExpiredError') {
      throw createUnauthorizedError('Token expired');
    }
    if (name === 'JsonWebTokenError' || name === 'NotBeforeError') {
      throw createUnauthorizedError('Invalid token');
    }
    throw createUnauthorizedError('Invalid token');
  }

  if (typeof decoded !== 'object' || decoded === null) {
    throw createUnauthorizedError('Invalid token');
  }
  const o = decoded as Record<string, unknown>;
  const userId = o.userId;
  if (typeof userId !== 'string' || !userId.trim()) {
    throw createUnauthorizedError('Invalid token');
  }

  return decoded as JwtPayload;
};
