import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export interface CreateApiKeyInput {
  name: string;
  tenantId: string;
  userId?: string;
  rateLimit?: number;
  expiresAt?: Date;
  permissions?: any;
}

export class ApiKeyService {
  /**
   * Generate a secure API key
   */
  private static generateApiKey(): { key: string; prefix: string; hash: string } {
    // Generate random key
    const randomBytes = crypto.randomBytes(32).toString('hex');
    const key = `sk_live_${randomBytes}`;
    
    // Create prefix for display (first 12 chars)
    const prefix = key.substring(0, 12);
    
    // Hash the key for storage
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    
    return { key, prefix, hash };
  }

  /**
   * Hash an API key
   */
  private static hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  /**
   * Create a new API key
   */
  static async createApiKey(input: CreateApiKeyInput): Promise<{ apiKey: any; plainKey: string }> {
    try {
      const { key, prefix, hash } = this.generateApiKey();

      const apiKey = await prisma.apiKey.create({
        data: {
          name: input.name,
          key: hash,
          prefix,
          tenantId: input.tenantId,
          userId: input.userId,
          rateLimit: input.rateLimit || 100,
          expiresAt: input.expiresAt,
          permissions: input.permissions,
        },
      });

      logger.info('[ApiKeyService] API key created', { 
        id: apiKey.id, 
        prefix: apiKey.prefix,
        tenantId: input.tenantId,
      });

      // Return both the DB record and the plain key (only shown once)
      return { apiKey, plainKey: key };
    } catch (error) {
      logger.error('[ApiKeyService] Error creating API key', { error });
      throw error;
    }
  }

  /**
   * Validate and get API key
   */
  static async validateApiKey(key: string): Promise<any | null> {
    try {
      const hash = this.hashKey(key);

      const apiKey = await prisma.apiKey.findUnique({
        where: { key: hash },
        include: { tenant: true },
      });

      if (!apiKey) {
        return null;
      }

      // Check if active
      if (!apiKey.isActive) {
        logger.warn('[ApiKeyService] Inactive API key used', { prefix: apiKey.prefix });
        return null;
      }

      // Check if expired
      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        logger.warn('[ApiKeyService] Expired API key used', { prefix: apiKey.prefix });
        return null;
      }

      // Update last used
      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      });

      return apiKey;
    } catch (error) {
      logger.error('[ApiKeyService] Error validating API key', { error });
      return null;
    }
  }

  /**
   * Check rate limit
   */
  static async checkRateLimit(apiKeyId: string): Promise<boolean> {
    try {
      const apiKey = await prisma.apiKey.findUnique({
        where: { id: apiKeyId },
      });

      if (!apiKey) {
        return false;
      }

      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60000);

      // Reset counter if last reset was more than 1 minute ago
      if (apiKey.lastReset < oneMinuteAgo) {
        await prisma.apiKey.update({
          where: { id: apiKeyId },
          data: {
            requestCount: 1,
            lastReset: now,
          },
        });
        return true;
      }

      // Check if rate limit exceeded
      if (apiKey.requestCount >= apiKey.rateLimit) {
        logger.warn('[ApiKeyService] Rate limit exceeded', { 
          apiKeyId, 
          requestCount: apiKey.requestCount,
          rateLimit: apiKey.rateLimit,
        });
        return false;
      }

      // Increment counter
      await prisma.apiKey.update({
        where: { id: apiKeyId },
        data: {
          requestCount: apiKey.requestCount + 1,
        },
      });

      return true;
    } catch (error) {
      logger.error('[ApiKeyService] Error checking rate limit', { error });
      return false;
    }
  }

  /**
   * Get all API keys for a tenant
   */
  static async getApiKeys(tenantId: string): Promise<any[]> {
    try {
      return await prisma.apiKey.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          prefix: true,
          rateLimit: true,
          requestCount: true,
          lastReset: true,
          isActive: true,
          expiresAt: true,
          lastUsedAt: true,
          createdAt: true,
          updatedAt: true,
          // Don't return the actual key
        },
      });
    } catch (error) {
      logger.error('[ApiKeyService] Error getting API keys', { error });
      throw error;
    }
  }

  /**
   * Revoke an API key
   */
  static async revokeApiKey(id: string, tenantId: string): Promise<void> {
    try {
      await prisma.apiKey.update({
        where: { id, tenantId },
        data: { isActive: false },
      });

      logger.info('[ApiKeyService] API key revoked', { id, tenantId });
    } catch (error) {
      logger.error('[ApiKeyService] Error revoking API key', { error });
      throw error;
    }
  }

  /**
   * Delete an API key
   */
  static async deleteApiKey(id: string, tenantId: string): Promise<void> {
    try {
      await prisma.apiKey.delete({
        where: { id, tenantId },
      });

      logger.info('[ApiKeyService] API key deleted', { id, tenantId });
    } catch (error) {
      logger.error('[ApiKeyService] Error deleting API key', { error });
      throw error;
    }
  }

  /**
   * Update API key
   */
  static async updateApiKey(
    id: string,
    tenantId: string,
    data: {
      name?: string;
      rateLimit?: number;
      permissions?: any;
      expiresAt?: Date;
    }
  ): Promise<any> {
    try {
      return await prisma.apiKey.update({
        where: { id, tenantId },
        data,
      });
    } catch (error) {
      logger.error('[ApiKeyService] Error updating API key', { error });
      throw error;
    }
  }
}

export const apiKeyService = ApiKeyService;
