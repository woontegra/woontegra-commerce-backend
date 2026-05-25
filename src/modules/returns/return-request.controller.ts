import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { returnRequestService } from './return-request.service';
import type { ReturnRequestStatus } from '@prisma/client';

export class ReturnRequestController {
  list = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const result = await returnRequestService.listByTenant(tenantId, {
        status: req.query.status as string | undefined,
        page:   Number(req.query.page) || 1,
        limit:  Number(req.query.limit) || 20,
      });
      res.json({ success: true, ...result });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Talepler alınamadı.' });
    }
  };

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const row = await returnRequestService.getByIdForTenant(req.params.id, tenantId);
      if (!row) {
        res.status(404).json({ success: false, error: 'Talep bulunamadı.' });
        return;
      }
      res.json({ success: true, request: row });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Talep alınamadı.' });
    }
  };

  updateStatus = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const status = req.body?.status as ReturnRequestStatus;
      const adminNote = typeof req.body?.adminNote === 'string' ? req.body.adminNote : undefined;
      if (!status) {
        res.status(400).json({ success: false, error: 'Durum gerekli.' });
        return;
      }
      const result = await returnRequestService.updateStatus(req.params.id, tenantId, status, adminNote);
      const { sync, ...request } = result;
      res.json({ success: true, request, sync });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Güncellenemedi.';
      res.status(/bulunamadı/i.test(msg) ? 404 : 400).json({ success: false, error: msg });
    }
  };

  listByOrder = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const orderId = req.params.orderId;
      const requests = await returnRequestService.listByOrder(tenantId, orderId);
      res.json({ success: true, requests });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Talepler alınamadı.' });
    }
  };
}

export const returnRequestController = new ReturnRequestController();
