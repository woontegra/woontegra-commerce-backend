import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../../config/env';

export interface JwtPayload {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
}

export const generateToken = (payload: JwtPayload): string => {
  const options: SignOptions = {
    expiresIn: '7d',
  };
  return jwt.sign(payload, config.jwtSecret, options);
};

export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
};
