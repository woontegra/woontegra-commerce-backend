import { Request, Response } from 'express';
import { ProductFilterService } from './product-filter.service';
import { AuthenticatedRequest } from '../auth/auth.types';

export class ProductFilterController {
  constructor(private filterService: ProductFilterService) {}

  async getFilteredProducts(req: AuthenticatedRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Parse query params to filters
      const filters = this.filterService.parseQueryParams(req.query);

      // Get filtered products
      const result = await this.filterService.getFilteredProducts(tenantId, filters);

      res.json({
        success: true,
        data: result.products,
        pagination: result.pagination,
      });
    } catch (error) {
      console.error('Error filtering products:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getFilterOptions(req: AuthenticatedRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Parse current filters
      const currentFilters = this.filterService.parseQueryParams(req.query);

      // Get available filter options
      const options = await this.filterService.getFilterOptions(tenantId, currentFilters);

      res.json({
        success: true,
        data: options,
      });
    } catch (error) {
      console.error('Error getting filter options:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
