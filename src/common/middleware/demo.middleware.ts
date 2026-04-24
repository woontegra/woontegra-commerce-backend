import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware';

interface DemoSession {
  id: string;
  startTime: Date;
  endTime: Date;
  isExpired: boolean;
  restrictions: {
    maxProducts: number;
    maxOrders: number;
    maxCustomers: number;
    allowApiAccess: boolean;
    allowExport: boolean;
    allowIntegrations: boolean;
  };
}

// In-memory demo session storage (in production, use Redis or database)
const demoSessions = new Map<string, DemoSession>();

export class DemoMiddleware {
  private static readonly DEMO_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds
  private static readonly DEMO_RESTRICTIONS = {
    maxProducts: 5,
    maxOrders: 3,
    maxCustomers: 10,
    allowApiAccess: false,
    allowExport: false,
    allowIntegrations: false
  };

  static createDemoSession = (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = req.cookies?.demoSessionId;
      
      if (sessionId && demoSessions.has(sessionId)) {
        const session = demoSessions.get(sessionId)!;
        
        if (session.isExpired || new Date() > session.endTime) {
          demoSessions.delete(sessionId);
          return res.status(410).json({
            error: 'Demo session expired',
            message: 'Demo süreniz dolmuştur. Yeni bir demo başlatın.',
            canRestart: true
          });
        }
        
        // Attach session to request
        (req as any).demoSession = session;
        return next();
      }

      // Create new demo session
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + DemoMiddleware.DEMO_DURATION);
      
      const newSession: DemoSession = {
        id: `demo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        startTime,
        endTime,
        isExpired: false,
        restrictions: DemoMiddleware.DEMO_RESTRICTIONS
      };

      demoSessions.set(newSession.id, newSession);

      // Set session cookie
      res.cookie('demoSessionId', newSession.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: DemoMiddleware.DEMO_DURATION,
        sameSite: 'strict'
      });

      (req as any).demoSession = newSession;
      next();
    } catch (error) {
      console.error('Demo session creation failed:', error);
      next(new AppError('Demo session creation failed', 500));
    }
  };

  static requireDemoSession = (req: Request, res: Response, next: NextFunction) => {
    const session = (req as any).demoSession;
    
    if (!session) {
      return res.status(401).json({
        error: 'Demo session required',
        message: 'Demo modunu başlatmanız gerekiyor.',
        redirectTo: '/demo'
      });
    }

    if (session.isExpired || new Date() > session.endTime) {
      demoSessions.delete(session.id);
      res.clearCookie('demoSessionId');
      
      return res.status(410).json({
        error: 'Demo session expired',
        message: 'Demo süreniz dolmuştur.',
        redirectTo: '/demo',
        canRestart: true
      });
    }

    next();
  };

  static checkDemoRestrictions = (action: string) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const session = (req as any).demoSession;
      
      if (!session) {
        return res.status(401).json({
          error: 'Demo session required',
          message: 'Bu özelliği kullanmak için demo modunu başlatın.',
          redirectTo: '/demo'
        });
      }

      const restrictions = session.restrictions;
      const timeRemaining = session.endTime.getTime() - new Date().getTime();

      // Check time remaining
      if (timeRemaining <= 0) {
        return res.status(410).json({
          error: 'Demo session expired',
          message: 'Demo süreniz dolmuştur.',
          timeRemaining: 0,
          redirectTo: '/demo'
        });
      }

      // Check specific restrictions
      switch (action) {
        case 'create_product':
          if (restrictions.maxProducts <= 0) {
            return res.status(403).json({
              error: 'Demo limit exceeded',
              message: 'Demo modunda en fazla 5 ürün ekleyebilirsiniz.',
              upgradePrompt: true,
              timeRemaining
            });
          }
          break;

        case 'create_order':
          if (restrictions.maxOrders <= 0) {
            return res.status(403).json({
              error: 'Demo limit exceeded',
              message: 'Demo modunda en fazla 3 sipariş oluşturabilirsiniz.',
              upgradePrompt: true,
              timeRemaining
            });
          }
          break;

        case 'create_customer':
          if (restrictions.maxCustomers <= 0) {
            return res.status(403).json({
              error: 'Demo limit exceeded',
              message: 'Demo modunda en fazla 10 müşteri ekleyebilirsiniz.',
              upgradePrompt: true,
              timeRemaining
            });
          }
          break;

        case 'api_access':
          if (!restrictions.allowApiAccess) {
            return res.status(403).json({
              error: 'Feature not available in demo',
              message: 'API erişimi demo modunda kullanılamaz.',
              upgradePrompt: true,
              timeRemaining
            });
          }
          break;

        case 'export_data':
          if (!restrictions.allowExport) {
            return res.status(403).json({
              error: 'Feature not available in demo',
              message: 'Veri dışa aktarma demo modunda kullanılamaz.',
              upgradePrompt: true,
              timeRemaining
            });
          }
          break;

        case 'integrations':
          if (!restrictions.allowIntegrations) {
            return res.status(403).json({
              error: 'Feature not available in demo',
              message: 'Entegrasyonlar demo modunda kullanılamaz.',
              upgradePrompt: true,
              timeRemaining
            });
          }
          break;
      }

      // Add time remaining to response headers
      res.setHeader('X-Demo-Time-Remaining', timeRemaining);
      res.setHeader('X-Demo-Session-ID', session.id);

      next();
    };
  };

  static updateDemoRestrictions = (req: Request, res: Response, next: NextFunction) => {
    const session = (req as any).demoSession;
    
    if (!session) {
      return next();
    }

    // Update restrictions based on usage
    // This would typically be called after successful operations
    const { action } = req.body;
    
    switch (action) {
      case 'product_created':
        session.restrictions.maxProducts = Math.max(0, session.restrictions.maxProducts - 1);
        break;
      case 'order_created':
        session.restrictions.maxOrders = Math.max(0, session.restrictions.maxOrders - 1);
        break;
      case 'customer_created':
        session.restrictions.maxCustomers = Math.max(0, session.restrictions.maxCustomers - 1);
        break;
    }

    demoSessions.set(session.id, session);
    next();
  };

  static getDemoSessionInfo = (req: Request, res: Response) => {
    const session = (req as any).demoSession;
    
    if (!session) {
      return res.json({
        hasDemoSession: false,
        message: 'Demo oturumu bulunamadı.'
      });
    }

    const timeRemaining = Math.max(0, session.endTime.getTime() - new Date().getTime());
    const timeRemainingMinutes = Math.floor(timeRemaining / (1000 * 60));
    const timeRemainingSeconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);

    res.json({
      hasDemoSession: true,
      sessionId: session.id,
      startTime: session.startTime,
      endTime: session.endTime,
      timeRemaining,
      timeRemainingMinutes,
      timeRemainingSeconds,
      restrictions: session.restrictions,
      isExpired: session.isExpired
    });
  };

  static endDemoSession = (req: Request, res: Response) => {
    const sessionId = req.cookies?.demoSessionId;
    
    if (sessionId && demoSessions.has(sessionId)) {
      demoSessions.delete(sessionId);
      res.clearCookie('demoSessionId');
    }

    res.json({
      success: true,
      message: 'Demo oturumu sonlandırıldı.'
    });
  };

  // Cleanup expired sessions (run periodically)
  static cleanupExpiredSessions = () => {
    const now = new Date();
    
    for (const [sessionId, session] of demoSessions.entries()) {
      if (session.isExpired || now > session.endTime) {
        demoSessions.delete(sessionId);
      }
    }
  };
}
