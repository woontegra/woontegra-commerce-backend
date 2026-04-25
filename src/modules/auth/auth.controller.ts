import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AppError } from '../../common/middleware/error.middleware';

export class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  register = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password, firstName, lastName, tenantSlug } = req.body;

      if (!email || !password || !firstName || !lastName || !tenantSlug) {
        throw new AppError('All fields are required', 400);
      }

      const result = await this.authService.register({
        email,
        password,
        firstName,
        lastName,
        tenantSlug,
      });

      res.status(201).json({
        status: 'success',
        data: result,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Registration failed' });
      }
    }
  };

  login = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password, tenantSlug } = req.body;

      if (!email || !password) {
        throw new AppError('Email ve şifre gereklidir.', 400);
      }

      const result = await this.authService.login({ email, password, tenantSlug });

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Login failed' });
      }
    }
  };

  saasRegister = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password, storeName, firstName, lastName } = req.body;

      if (!email || !password || !storeName) {
        throw new AppError('Email, password, and store name are required', 400);
      }

      if (password.length < 6) {
        throw new AppError('Password must be at least 6 characters', 400);
      }

      const result = await this.authService.saasRegister({
        email,
        password,
        storeName,
        firstName,
        lastName,
      });

      res.status(201).json({
        status: 'success',
        data: result,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Registration failed' });
      }
    }
  };

  // Get current user info
  me = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as any).user;
      if (!user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      res.status(200).json({
        status: 'success',
        data: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenantId: user.tenantId,
        },
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get user info' });
    }
  };
}
