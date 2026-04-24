import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../../common/middleware/error.middleware';

const prisma = new PrismaClient();

export class ShippingController {
  getAll = async (req: Request, res: Response): Promise<void> => {
    try {
      const shippingMethods = await prisma.shippingMethod.findMany({
        where: {
          isActive: true,
        },
        orderBy: {
          price: 'asc',
        },
      });

      res.status(200).json({
        status: 'success',
        data: shippingMethods,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch shipping methods' });
    }
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const shippingMethod = await prisma.shippingMethod.findUnique({
        where: { id },
      });

      if (!shippingMethod) {
        throw new AppError('Shipping method not found', 404);
      }

      res.status(200).json({
        status: 'success',
        data: shippingMethod,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to fetch shipping method' });
      }
    }
  };

  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, description, price, estimatedDays, tenantId } = req.body;

      if (!name || price === undefined) {
        throw new AppError('Name and price are required', 400);
      }

      const shippingMethod = await prisma.shippingMethod.create({
        data: {
          name,
          description,
          price,
          estimatedDays,
          tenantId,
        },
      });

      res.status(201).json({
        status: 'success',
        data: shippingMethod,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to create shipping method' });
      }
    }
  };

  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { name, description, price, estimatedDays, isActive } = req.body;

      const shippingMethod = await prisma.shippingMethod.update({
        where: { id },
        data: {
          name,
          description,
          price,
          estimatedDays,
          isActive,
        },
      });

      res.status(200).json({
        status: 'success',
        data: shippingMethod,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to update shipping method' });
      }
    }
  };

  delete = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      await prisma.shippingMethod.delete({
        where: { id },
      });

      res.status(200).json({
        status: 'success',
        message: 'Shipping method deleted successfully',
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to delete shipping method' });
      }
    }
  };
}
