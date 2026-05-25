import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { returnRefundService, REFUND_METHODS } from './return-refund.service';
import type { RefundMethod } from '@prisma/client';

export class ReturnRefundController {
  list = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const result = await returnRefundService.getSummary(req.params.id, tenantId);
      res.json({ success: true, ...result });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Kayıtlar alınamadı.';
      res.status(/bulunamadı/i.test(msg) ? 404 : 400).json({ success: false, error: msg });
    }
  };

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const amount = Number(req.body?.amount);
      const method = req.body?.method as RefundMethod;
      const note = typeof req.body?.note === 'string' ? req.body.note : undefined;
      const refundedAtRaw = req.body?.refundedAt;

      if (!method || !REFUND_METHODS.includes(method)) {
        res.status(400).json({ success: false, error: 'Geçerli bir iade yöntemi seçin.' });
        return;
      }
      if (!refundedAtRaw) {
        res.status(400).json({ success: false, error: 'İade tarihi gerekli.' });
        return;
      }
      const refundedAt = new Date(refundedAtRaw);
      if (Number.isNaN(refundedAt.getTime())) {
        res.status(400).json({ success: false, error: 'Geçersiz iade tarihi.' });
        return;
      }

      const result = await returnRefundService.create(req.params.id, tenantId, {
        amount,
        method,
        note,
        refundedAt,
      });
      res.status(201).json({ success: true, ...result });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Kayıt oluşturulamadı.';
      res.status(/bulunamadı/i.test(msg) ? 404 : 400).json({ success: false, error: msg });
    }
  };

  cancel = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const result = await returnRefundService.cancel(req.params.refundId, tenantId);
      res.json({ success: true, ...result });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'İptal edilemedi.';
      res.status(/bulunamadı/i.test(msg) ? 404 : 400).json({ success: false, error: msg });
    }
  };
}

export const returnRefundController = new ReturnRefundController();
