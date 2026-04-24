import { Request, Response } from 'express';
import { B2BService } from './b2b.service';
import { AuthenticatedRequest } from '../auth/auth.types';

export class B2BController {
  constructor(private b2bService: B2BService) {}

  // Customer Groups
  async getCustomerGroups(req: AuthenticatedRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant ID required' });
      }

      const groups = await this.b2bService.getCustomerGroups(tenantId);
      res.json(groups);
    } catch (error) {
      console.error('Error getting customer groups:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async createCustomerGroup(req: AuthenticatedRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant ID required' });
      }

      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ error: 'Group name is required' });
      }

      const group = await this.b2bService.createCustomerGroup(tenantId, name);
      res.status(201).json(group);
    } catch (error) {
      console.error('Error creating customer group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async updateCustomerGroup(req: AuthenticatedRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant ID required' });
      }

      const { id } = req.params;
      const { name } = req.body;

      const group = await this.b2bService.updateCustomerGroup(id, tenantId, name);
      res.json(group);
    } catch (error) {
      console.error('Error updating customer group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async deleteCustomerGroup(req: AuthenticatedRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant ID required' });
      }

      const { id } = req.params;
      await this.b2bService.deleteCustomerGroup(id, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting customer group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Customer Group Assignment
  async assignCustomerToGroup(req: AuthenticatedRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant ID required' });
      }

      const { customerId, groupId } = req.body;
      if (!customerId || !groupId) {
        return res.status(400).json({ error: 'Customer ID and Group ID are required' });
      }

      const customer = await this.b2bService.assignCustomerToGroup(customerId, groupId, tenantId);
      res.json(customer);
    } catch (error) {
      console.error('Error assigning customer to group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getCustomersByGroup(req: AuthenticatedRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant ID required' });
      }

      const { groupId } = req.params;
      const customers = await this.b2bService.getCustomersByGroup(groupId, tenantId);
      res.json(customers);
    } catch (error) {
      console.error('Error getting customers by group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Product Group Pricing
  async updateProductGroupPricing(req: AuthenticatedRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant ID required' });
      }

      const { variantId } = req.params;
      const { wholesalePrice, groupPrices } = req.body;

      const variant = await this.b2bService.updateProductGroupPricing(
        variantId,
        tenantId,
        wholesalePrice,
        groupPrices
      );
      res.json(variant);
    } catch (error) {
      console.error('Error updating product group pricing:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getProductPricing(req: AuthenticatedRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant ID required' });
      }

      const { variantId } = req.params;
      const { customerId } = req.query;

      const pricing = await this.b2bService.getProductPricing(variantId, tenantId, customerId as string);
      res.json(pricing);
    } catch (error) {
      console.error('Error getting product pricing:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
