import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { OrderService } from './order.service';
import { AppError } from '../../common/middleware/error.middleware';

export class OrderController {
  private orderService: OrderService;

  constructor() {
    this.orderService = new OrderService();
  }

  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const orders = await this.orderService.getAll(tenantId);

      res.status(200).json({
        status: 'success',
        data: orders,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch orders' });
    }
  };

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const tenantId = req.user!.tenantId;

      const order = await this.orderService.getById(id, tenantId);

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      res.status(200).json({
        status: 'success',
        data: order,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to fetch order' });
      }
    }
  };

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const order = await this.orderService.create(req.body, tenantId);

      res.status(201).json({
        status: 'success',
        data: order,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create order' });
    }
  };

  updateStatus = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { status } = req.body;
      const tenantId = req.user!.tenantId;

      if (!status) {
        throw new AppError('Status is required', 400);
      }

      const order = await this.orderService.updateStatus(id, status, tenantId);

      res.status(200).json({
        status: 'success',
        data: order,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to update order status' });
      }
    }
  };

  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const tenantId = req.user!.tenantId;

      await this.orderService.delete(id, tenantId);

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete order' });
    }
  };

  getByCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const customerId = req.params.customerId as string;
      const tenantId = req.user!.tenantId;

      const orders = await this.orderService.getByCustomer(customerId, tenantId);

      res.status(200).json({
        status: 'success',
        data: orders,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch customer orders' });
    }
  };
}
