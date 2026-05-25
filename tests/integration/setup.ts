/**
 * Integration test ortamı — unit test setup'tan sonra yüklenir.
 */
import dotenv from 'dotenv';

dotenv.config();

process.env.NODE_ENV = 'test';
process.env.LOG_CONSOLE = 'false';
process.env.LOG_FILE = 'false';

const dbUrl = process.env.INTEGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (dbUrl) {
  process.env.DATABASE_URL = dbUrl;
  process.env.INTEGRATION_DATABASE_URL = dbUrl;
}

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-jwt-secret-min-32-chars';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'integration-refresh-secret-32';
process.env.MARKETPLACE_ENCRYPTION_KEY = process.env.MARKETPLACE_ENCRYPTION_KEY || 'integration-marketplace-key-32chars';
process.env.IYZICO_SECRET_KEY = process.env.IYZICO_SECRET_KEY || 'integration-iyzico-secret';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
