import { Request, Response } from 'express';
import prisma from '../../config/database';

interface AuthRequest extends Request {
  user?: {
    userId: string;
    tenantId: string;
    role: string;
    email: string;
  };
}

export class LeadController {
  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, email, source = 'landing' } = req.body ?? {};
      const safeEmail = String(email ?? '').trim().toLowerCase();

      if (!safeEmail || !/^\S+@\S+\.\S+$/.test(safeEmail)) {
        res.status(400).json({ success: false, message: 'Geçerli bir e-posta gereklidir.' });
        return;
      }

      await prisma.lead.create({
        data: {
          name: name ? String(name).trim() : null,
          email: safeEmail,
          source: String(source || 'landing'),
        },
      });

      res.status(201).json({ success: true, message: 'Teşekkürler! Sizinle kısa süre içinde iletişime geçeceğiz.' });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message || 'Lead kaydedilemedi.' });
    }
  };

  list = async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const leads = await prisma.lead.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      res.json({ success: true, data: leads });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message || 'Lead listesi alınamadı.' });
    }
  };
}

export const leadController = new LeadController();
