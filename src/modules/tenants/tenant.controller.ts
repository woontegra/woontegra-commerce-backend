import { Request, Response } from 'express';
import { TenantService } from './tenant.service';
import { AppError } from '../../common/middleware/error.middleware';

export class TenantController {
  private tenantService: TenantService;

  constructor() {
    this.tenantService = new TenantService();
  }

  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, slug, domain } = req.body;

      if (!name || !slug) {
        throw new AppError('Name and slug are required', 400);
      }

      const tenant = await this.tenantService.create({ name, slug, domain });

      res.status(201).json({
        status: 'success',
        data: tenant,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to create tenant' });
      }
    }
  };

  getAll = async (req: Request, res: Response): Promise<void> => {
    try {
      const tenants = await this.tenantService.getAll();

      res.status(200).json({
        status: 'success',
        data: tenants,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch tenants' });
    }
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const tenant = await this.tenantService.getById(id);

      if (!tenant) {
        throw new AppError('Tenant not found', 404);
      }

      res.status(200).json({
        status: 'success',
        data: tenant,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to fetch tenant' });
      }
    }
  };

  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { name, slug, domain, isActive } = req.body;

      const tenant = await this.tenantService.update(id, {
        name,
        slug,
        domain,
        isActive,
      });

      res.status(200).json({
        status: 'success',
        data: tenant,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to update tenant' });
      }
    }
  };

  delete = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      await this.tenantService.delete(id);

      res.status(200).json({
        status: 'success',
        message: 'Tenant deleted successfully',
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to delete tenant' });
      }
    }
  };
}
