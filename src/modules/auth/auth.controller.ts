import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AppError } from '../../common/middleware/AppError';
import prisma from '../../config/database';

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
      const {
        email, password, storeName, firstName, lastName,
        kvkkAccepted, privacyAccepted, termsAccepted,
      } = req.body;

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
        kvkkAccepted: Boolean(kvkkAccepted),
        privacyAccepted: Boolean(privacyAccepted),
        termsAccepted: Boolean(termsAccepted),
        ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || null,
        userAgent: req.get('user-agent') || null,
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

  demoLogin = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.authService.demoLogin();
      res.status(200).json({ status: 'success', data: result });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error('Demo login error:', error);
        res.status(500).json({ error: 'Demo giriş başarısız.' });
      }
    }
  };

  // Get current user info
  me = async (req: Request, res: Response): Promise<void> => {
    try {
      const u = (req as any).user;
      if (!u?.userId) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const row = await prisma.user.findUnique({
        where: { id: u.userId },
        select: {
          id: true, email: true, firstName: true, lastName: true, role: true, tenantId: true,
          onboardingCompleted: true, onboardingStep: true,
        },
      });

      if (!row) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const impersonation = (req as any).impersonation as
        | { adminUserId: string; adminEmail?: string }
        | undefined;
      const isImp = Boolean((req as any).isImpersonation);
      const adminId = (req as any).impersonationAdminId as string | undefined;

      res.status(200).json({
        status: 'success',
        data: {
          ...row,
          impersonation: impersonation || isImp
            ? {
                adminUserId: impersonation?.adminUserId ?? adminId ?? null,
                adminEmail:  impersonation?.adminEmail ?? null,
                adminId:     adminId ?? impersonation?.adminUserId ?? null,
                isImpersonation: isImp,
              }
            : null,
        },
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get user info' });
    }
  };
}
