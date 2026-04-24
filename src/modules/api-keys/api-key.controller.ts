import { Request, Response } from 'express';
import { ApiKeyService } from '../../services/api-key.service';

interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

export class ApiKeyController {
  /**
   * Create a new API key
   */
  async createApiKey(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const userId = req.user?.id;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { name, rateLimit, expiresAt, permissions } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }

      const { apiKey, plainKey } = await ApiKeyService.createApiKey({
        name,
        tenantId,
        userId,
        rateLimit,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        permissions,
      });

      res.json({
        success: true,
        data: {
          ...apiKey,
          key: plainKey, // Only shown once!
        },
        message: 'API key created. Save this key securely - it will not be shown again!',
      });
    } catch (error) {
      console.error('Error creating API key:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get all API keys
   */
  async getApiKeys(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const apiKeys = await ApiKeyService.getApiKeys(tenantId);

      res.json({ success: true, data: apiKeys });
    } catch (error) {
      console.error('Error getting API keys:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update an API key
   */
  async updateApiKey(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { name, rateLimit, permissions, expiresAt } = req.body;

      const apiKey = await ApiKeyService.updateApiKey(id, tenantId, {
        name,
        rateLimit,
        permissions,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      });

      res.json({ success: true, data: apiKey });
    } catch (error) {
      console.error('Error updating API key:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      await ApiKeyService.revokeApiKey(id, tenantId);

      res.json({ success: true, message: 'API key revoked' });
    } catch (error) {
      console.error('Error revoking API key:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Delete an API key
   */
  async deleteApiKey(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user?.tenantId;
      const { id } = req.params;

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      await ApiKeyService.deleteApiKey(id, tenantId);

      res.json({ success: true, message: 'API key deleted' });
    } catch (error) {
      console.error('Error deleting API key:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const apiKeyController = new ApiKeyController();
