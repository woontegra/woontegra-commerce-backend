import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { CategoryService } from './category.service';
import { AppError } from '../../common/middleware/error.middleware';

export class CategoryController {
  private categoryService: CategoryService;

  constructor() {
    this.categoryService = new CategoryService();
  }

  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const categories = await this.categoryService.getAll(tenantId);

      res.status(200).json({
        status: 'success',
        data: categories,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch categories' });
    }
  };

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const tenantId = req.user!.tenantId;

      const category = await this.categoryService.getById(id, tenantId);

      if (!category) {
        throw new AppError('Category not found', 404);
      }

      res.status(200).json({
        status: 'success',
        data: category,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to fetch category' });
      }
    }
  };

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const category = await this.categoryService.create(req.body, tenantId);

      res.status(201).json({
        status: 'success',
        data: category,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create category' });
    }
  };

  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const tenantId = req.user!.tenantId;

      const category = await this.categoryService.update(id, req.body, tenantId);

      res.status(200).json({
        status: 'success',
        data: category,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update category' });
    }
  };

  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const tenantId = req.user!.tenantId;

      await this.categoryService.delete(id, tenantId);

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete category' });
    }
  };

  getProducts = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const categoryId = req.params.id as string;
      const tenantId = req.user!.tenantId;

      const products = await this.categoryService.getProductsByCategory(
        categoryId,
        tenantId
      );

      res.status(200).json({
        status: 'success',
        data: products,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch products by category' });
    }
  };
}
