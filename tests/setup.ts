/**
 * Test ortamı — modül importlarından önce yüklenir.
 */
import dotenv from 'dotenv';

dotenv.config();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/woontegra_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-minimum-32-characters-long';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-min-32-chars';
process.env.MARKETPLACE_ENCRYPTION_KEY = process.env.MARKETPLACE_ENCRYPTION_KEY || 'test-marketplace-encryption-key-32';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'smtp';
process.env.EMAIL_API_KEY = process.env.EMAIL_API_KEY || 'test-email-key';
