import { Response } from 'express';
import { ContactMessageStatus } from '@prisma/client';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import prisma from '../../config/database';
import { AppError } from '../../common/middleware/AppError';

function tenantIdFromReq(req: AuthRequest): string {
  const id = req.user?.tenantId;
  if (!id) throw new AppError('Tenant information missing', 403);
  return id;
}

const STATUSES: ContactMessageStatus[] = ['NEW', 'READ', 'ARCHIVED'];

function normalizeStatus(raw: unknown): ContactMessageStatus | null {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return STATUSES.includes(s as ContactMessageStatus) ? (s as ContactMessageStatus) : null;
}

export class ContactMessagesController {
  list = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = tenantIdFromReq(req);
      const status = normalizeStatus(req.query.status);
      const messages = await prisma.contactMessage.findMany({
        where: {
          tenantId,
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
      res.status(200).json({ status: 'success', data: messages });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Mesajlar yüklenemedi.' });
    }
  };

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = tenantIdFromReq(req);
      const id = String(req.params.id ?? '');
      const message = await prisma.contactMessage.findFirst({
        where: { id, tenantId },
      });
      if (!message) throw new AppError('Mesaj bulunamadı.', 404);
      res.status(200).json({ status: 'success', data: message });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Mesaj yüklenemedi.' });
      }
    }
  };

  updateStatus = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = tenantIdFromReq(req);
      const id = String(req.params.id ?? '');
      const status = normalizeStatus(req.body?.status);
      if (!status) throw new AppError('Geçersiz durum (NEW, READ, ARCHIVED).', 400);

      const existing = await prisma.contactMessage.findFirst({
        where: { id, tenantId },
      });
      if (!existing) throw new AppError('Mesaj bulunamadı.', 404);

      const updated = await prisma.contactMessage.update({
        where: { id },
        data: { status },
      });
      res.status(200).json({ status: 'success', data: updated });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Durum güncellenemedi.' });
      }
    }
  };
}
