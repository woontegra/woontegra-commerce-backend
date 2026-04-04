import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { ProductService } from './product.service';
import { AppError } from '../../common/middleware/error.middleware';

export class ProductController {
  private productService: ProductService;

  constructor() {
    this.productService = new ProductService();
  }

  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const products = await this.productService.getAll(tenantId);

      res.status(200).json({
        status: 'success',
        data: products,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  };

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const tenantId = req.user!.tenantId;

      const product = await this.productService.getById(id, tenantId);

      if (!product) {
        throw new AppError('Product not found', 404);
      }

      res.status(200).json({
        status: 'success',
        data: product,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to fetch product' });
      }
    }
  };

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const product = await this.productService.create(req.body, tenantId);

      res.status(201).json({
        status: 'success',
        data: product,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create product' });
    }
  };

  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const tenantId = req.user!.tenantId;

      const product = await this.productService.update(id, req.body, tenantId);

      res.status(200).json({
        status: 'success',
        data: product,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update product' });
    }
  };

  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const tenantId = req.user!.tenantId;

      await this.productService.delete(id, tenantId);

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete product' });
    }
  };
}
