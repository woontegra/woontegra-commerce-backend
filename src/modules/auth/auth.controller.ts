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

      if (!email || !password || !tenantSlug) {
        throw new AppError('Email, password, and tenant are required', 400);
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
}
