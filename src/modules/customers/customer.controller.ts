import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { CustomerService } from './customer.service';

export class CustomerController {
  private svc = new CustomerService();

  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const result   = await this.svc.getAll(tenantId, {
        page:   req.query.page   as any,
        limit:  req.query.limit  as any,
        search: req.query.search as string,
      });
      res.status(200).json({ status: 'success', data: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Müşteriler alınamadı.' });
    }
  };

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const customer = await this.svc.getById(req.params.id, tenantId);
      if (!customer) {
        res.status(404).json({ error: 'Müşteri bulunamadı.' });
        return;
      }
      res.status(200).json({ status: 'success', data: customer });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Müşteri alınamadı.' });
    }
  };

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const customer = await this.svc.create(req.body, tenantId);
      res.status(201).json({ status: 'success', data: customer });
    } catch (err: any) {
      const isDup = err.message?.includes('zaten kayıtlı');
      res.status(isDup ? 409 : 500).json({ error: err.message ?? 'Müşteri oluşturulamadı.' });
    }
  };

  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const customer = await this.svc.update(req.params.id, req.body, tenantId);
      res.status(200).json({ status: 'success', data: customer });
    } catch (err: any) {
      const is404  = err.message?.includes('bulunamadı');
      const is409  = err.message?.includes('başka bir müşteri');
      const status = is404 ? 404 : is409 ? 409 : 500;
      res.status(status).json({ error: err.message ?? 'Güncelleme başarısız.' });
    }
  };

  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      await this.svc.delete(req.params.id, tenantId);
      res.status(204).send();
    } catch (err: any) {
      const is404 = err.message?.includes('bulunamadı');
      res.status(is404 ? 404 : 500).json({ error: err.message ?? 'Silme başarısız.' });
    }
  };

  getStats = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const stats    = await this.svc.getStats(tenantId);
      res.status(200).json({ status: 'success', data: stats });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'İstatistikler alınamadı.' });
    }
  };
}
