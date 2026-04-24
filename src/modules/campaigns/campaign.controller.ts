import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { CampaignService } from './campaign.service';

export class CampaignController {
  private svc = new CampaignService();

  private tid(req: AuthRequest) { return req.user!.tenantId!; }

  // ── Campaign CRUD ──────────────────────────────────────────────────────────

  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const result = await this.svc.getAll(this.tid(req), {
        page:   req.query.page   as any,
        limit:  req.query.limit  as any,
        active: req.query.active as any,
        search: req.query.search as string,
      });
      res.json({ status: 'success', data: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Kampanyalar alınamadı.' });
    }
  };

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaign = await this.svc.getById(req.params.id, this.tid(req));
      if (!campaign) { res.status(404).json({ error: 'Kampanya bulunamadı.' }); return; }
      res.json({ status: 'success', data: campaign });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getActive = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaigns = await this.svc.getActive(this.tid(req));
      res.json({ status: 'success', data: campaigns });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getStats = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const stats = await this.svc.getStats(this.tid(req));
      res.json({ status: 'success', data: stats });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaign = await this.svc.create(req.body, this.tid(req));
      res.status(201).json({ status: 'success', data: campaign });
    } catch (err: any) {
      const isValidation = /olamaz|olmalı|Geçersiz/.test(err.message ?? '');
      res.status(isValidation ? 422 : 500).json({ error: err.message ?? 'Kampanya oluşturulamadı.' });
    }
  };

  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaign = await this.svc.update(req.params.id, req.body, this.tid(req));
      res.json({ status: 'success', data: campaign });
    } catch (err: any) {
      res.status(err.message?.includes('bulunamadı') ? 404 : 500).json({ error: err.message });
    }
  };

  toggle = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaign = await this.svc.toggle(req.params.id, this.tid(req));
      res.json({ status: 'success', data: campaign });
    } catch (err: any) {
      res.status(err.message?.includes('bulunamadı') ? 404 : 500).json({ error: err.message });
    }
  };

  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await this.svc.delete(req.params.id, this.tid(req));
      res.status(204).send();
    } catch (err: any) {
      res.status(err.message?.includes('bulunamadı') ? 404 : 500).json({ error: err.message });
    }
  };

  // ── Rule CRUD ──────────────────────────────────────────────────────────────

  addRule = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { type, conditions, actions, priority, isActive } = req.body;
      if (!type)       { res.status(400).json({ error: 'type zorunludur.' });       return; }
      if (!conditions) { res.status(400).json({ error: 'conditions zorunludur.' }); return; }
      if (!actions)    { res.status(400).json({ error: 'actions zorunludur.' });    return; }

      const rule = await this.svc.addRule(req.params.id, this.tid(req), {
        type, conditions, actions, priority, isActive,
      });
      res.status(201).json({ status: 'success', data: rule });
    } catch (err: any) {
      res.status(err.message?.includes('bulunamadı') ? 404 : 500).json({ error: err.message });
    }
  };

  updateRule = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const rule = await this.svc.updateRule(
        req.params.ruleId,
        req.params.id,
        this.tid(req),
        req.body,
      );
      res.json({ status: 'success', data: rule });
    } catch (err: any) {
      res.status(err.message?.includes('bulunamadı') ? 404 : 500).json({ error: err.message });
    }
  };

  deleteRule = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await this.svc.deleteRule(req.params.ruleId, req.params.id, this.tid(req));
      res.status(204).send();
    } catch (err: any) {
      res.status(err.message?.includes('bulunamadı') ? 404 : 500).json({ error: err.message });
    }
  };

  // ── Engine ─────────────────────────────────────────────────────────────────

  /**
   * POST /campaigns/apply
   * body: { cartItems: [{ productId, variantId?, quantity, price, categoryId? }] }
   */
  applyToCart = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { cartItems } = req.body;
      if (!Array.isArray(cartItems)) {
        res.status(400).json({ error: 'cartItems dizisi zorunludur.' });
        return;
      }

      // Basic validation
      for (const [i, item] of cartItems.entries()) {
        if (!item.productId) { res.status(400).json({ error: `cartItems[${i}].productId zorunludur.` }); return; }
        if (typeof item.price    !== 'number' || item.price    < 0) { res.status(400).json({ error: `cartItems[${i}].price geçersiz.` });    return; }
        if (typeof item.quantity !== 'number' || item.quantity <= 0) { res.status(400).json({ error: `cartItems[${i}].quantity geçersiz.` }); return; }
      }

      const result = await this.svc.applyToCart(cartItems, this.tid(req));
      res.json({ status: 'success', data: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  /** POST /campaigns/calculate — legacy single-price endpoint */
  calculate = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const price = parseFloat(req.body.price);
      if (!Number.isFinite(price) || price < 0) {
        res.status(422).json({ error: 'Geçerli bir fiyat giriniz.' });
        return;
      }
      const result = await this.svc.calculatePrice(price, this.tid(req));
      res.json({ status: 'success', data: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
