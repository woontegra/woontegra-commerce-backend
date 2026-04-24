import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { CouponService } from './coupon.service';

export class CouponController {
  private svc = new CouponService();

  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const result   = await this.svc.getAll(tenantId, {
        page:   req.query.page   as any,
        limit:  req.query.limit  as any,
        active: req.query.active as any,
        search: req.query.search as string,
      });
      res.json({ status: 'success', data: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Kuponlar alınamadı.' });
    }
  };

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const c = await this.svc.getById(req.params.id, req.user!.tenantId!);
      if (!c) { res.status(404).json({ error: 'Kupon bulunamadı.' }); return; }
      res.json({ status: 'success', data: c });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getStats = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const stats = await this.svc.getStats(req.user!.tenantId!);
      res.json({ status: 'success', data: stats });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  /**
   * POST /coupons/validate
   * body: { code, orderAmount }
   * Returns validation result + calculated discount — does NOT apply the coupon.
   */
  validate = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { code, orderAmount } = req.body;
      if (!code) { res.status(422).json({ error: 'Kupon kodu zorunludur.' }); return; }
      const amount = parseFloat(orderAmount);
      if (!Number.isFinite(amount) || amount < 0) {
        res.status(422).json({ error: 'Geçerli bir sipariş tutarı giriniz.' });
        return;
      }
      const result = await this.svc.validate(code, amount, req.user!.tenantId!);
      res.json({ status: 'success', data: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const coupon = await this.svc.create(req.body, req.user!.tenantId!);
      res.status(201).json({ status: 'success', data: coupon });
    } catch (err: any) {
      const is422 = err.message?.match(/zorunlu|büyük|içerebilir|geçemez|kullanımda/i);
      res.status(is422 ? 422 : 500).json({ error: err.message ?? 'Kupon oluşturulamadı.' });
    }
  };

  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const coupon = await this.svc.update(req.params.id, req.body, req.user!.tenantId!);
      res.json({ status: 'success', data: coupon });
    } catch (err: any) {
      const is404 = err.message?.includes('bulunamadı');
      res.status(is404 ? 404 : 500).json({ error: err.message });
    }
  };

  toggle = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const coupon = await this.svc.toggle(req.params.id, req.user!.tenantId!);
      res.json({ status: 'success', data: coupon });
    } catch (err: any) {
      const is404 = err.message?.includes('bulunamadı');
      res.status(is404 ? 404 : 500).json({ error: err.message });
    }
  };

  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await this.svc.delete(req.params.id, req.user!.tenantId!);
      res.status(204).send();
    } catch (err: any) {
      const is404 = err.message?.includes('bulunamadı');
      res.status(is404 ? 404 : 500).json({ error: err.message });
    }
  };
}
