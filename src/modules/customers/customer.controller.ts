import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { CustomerService } from './customer.service';
import { AppError } from '../../common/middleware/error.middleware';

export class CustomerController {
  private customerService: CustomerService;

  constructor() {
    this.customerService = new CustomerService();
  }

  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const customers = await this.customerService.getAll(tenantId);

      res.status(200).json({
        status: 'success',
        data: customers,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch customers' });
    }
  };

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const tenantId = req.user!.tenantId;

      const customer = await this.customerService.getById(id, tenantId);

      if (!customer) {
        throw new AppError('Customer not found', 404);
      }

      res.status(200).json({
        status: 'success',
        data: customer,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to fetch customer' });
      }
    }
  };

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const customer = await this.customerService.create(req.body, tenantId);

      res.status(201).json({
        status: 'success',
        data: customer,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create customer' });
    }
  };

  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const tenantId = req.user!.tenantId;

      const customer = await this.customerService.update(id, req.body, tenantId);

      res.status(200).json({
        status: 'success',
        data: customer,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update customer' });
    }
  };

  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const tenantId = req.user!.tenantId;

      await this.customerService.delete(id, tenantId);

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete customer' });
    }
  };
}
