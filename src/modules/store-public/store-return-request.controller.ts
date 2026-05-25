import { Response } from 'express';
import { logger } from '../../config/logger';
import { returnRequestService } from '../returns/return-request.service';
import { pickCustomerReturnRequestPublic } from './store-account.presenter';
import { createReturnRequestSchema } from './store-return-request.dto';
import type { StoreCustomerAuthRequest } from './store-customer-auth.middleware';

export async function listMyReturns(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const returns = await returnRequestService.listByCustomer(
      req.storeTenant.id,
      req.storeCustomer.customerId,
    );
    res.json({
      success: true,
      returns: returns
        .map(r => pickCustomerReturnRequestPublic(r as never))
        .filter((r): r is NonNullable<typeof r> => r != null),
    });
  } catch (e: unknown) {
    logger.error({
      message: '[StoreReturns] listMyReturns failed',
      tenantId: req.storeTenant?.id,
      customerId: req.storeCustomer?.customerId,
      error: e instanceof Error ? e.message : 'Unknown error',
    });
    res.status(500).json({
      success: false,
      error: 'İade / iptal talepleriniz şu anda yüklenemedi.',
    });
  }
}

export async function getMyReturn(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const row = await returnRequestService.getByIdForCustomer(
      req.params.id,
      req.storeTenant.id,
      req.storeCustomer.customerId,
    );
    if (!row) {
      res.status(404).json({ success: false, error: 'Talep bulunamadı.' });
      return;
    }
    const request = pickCustomerReturnRequestPublic(row as never);
    if (!request) {
      res.status(404).json({ success: false, error: 'Talep bulunamadı.' });
      return;
    }
    const refunds = 'refunds' in row && Array.isArray(row.refunds) ? row.refunds : undefined;
    res.json({
      success: true,
      request: refunds?.length ? { ...request, refunds } : request,
    });
  } catch (e: unknown) {
    logger.error({
      message: '[StoreReturns] getMyReturn failed',
      returnId: req.params.id,
      tenantId: req.storeTenant?.id,
      error: e instanceof Error ? e.message : 'Unknown error',
    });
    res.status(500).json({
      success: false,
      error: 'Talep detayı şu anda yüklenemedi.',
    });
  }
}

export async function createReturnRequest(req: StoreCustomerAuthRequest, res: Response): Promise<void> {
  try {
    if (!req.storeCustomer || !req.storeTenant) {
      res.status(401).json({ success: false, error: 'Giriş yapmanız gerekiyor.' });
      return;
    }
    const orderNumber = typeof req.params.orderNumber === 'string' ? req.params.orderNumber.trim() : '';
    if (!orderNumber) {
      res.status(400).json({ success: false, error: 'Sipariş numarası gerekli.' });
      return;
    }

    const parsed = createReturnRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues.map(i => i.message).join('; ') });
      return;
    }

    const request = await returnRequestService.createForCustomer(
      req.storeTenant.id,
      req.storeCustomer.customerId,
      orderNumber,
      parsed.data,
    );
    const publicRequest = pickCustomerReturnRequestPublic(request as never);
    res.status(201).json({ success: true, request: publicRequest });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Talep oluşturulamadı.';
    res.status(400).json({ success: false, error: msg });
  }
}
