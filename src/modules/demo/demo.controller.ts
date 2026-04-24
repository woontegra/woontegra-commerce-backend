import { Request, Response } from 'express';
import { DemoMiddleware } from '../../common/middleware/demo.middleware';

export const getDemoSession = (req: Request, res: Response) => {
  try {
    DemoMiddleware.getDemoSessionInfo(req, res);
  } catch (error) {
    console.error('Get demo session error:', error);
    res.status(500).json({ error: 'Failed to get demo session' });
  }
};

export const endDemoSession = (req: Request, res: Response) => {
  try {
    DemoMiddleware.endDemoSession(req, res);
  } catch (error) {
    console.error('End demo session error:', error);
    res.status(500).json({ error: 'Failed to end demo session' });
  }
};

export const startDemoSession = (req: Request, res: Response) => {
  try {
    // Create new demo session
    DemoMiddleware.createDemoSession(req, res, () => {
      const session = (req as any).demoSession;
      
      res.json({
        success: true,
        message: 'Demo session created successfully',
        session: {
          id: session.id,
          startTime: session.startTime,
          endTime: session.endTime,
          restrictions: session.restrictions
        }
      });
    });
  } catch (error) {
    console.error('Start demo session error:', error);
    res.status(500).json({ error: 'Failed to start demo session' });
  }
};
