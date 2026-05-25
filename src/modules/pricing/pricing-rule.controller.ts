import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import prisma from '../../config/database';
import { normalizePriceType } from './pricing-rule.service';

export class PricingRuleController {
  list = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const rows = await prisma.pricingRule.findMany({
        where:   { tenantId },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: { category: { select: { id: true, name: true } } },
      });
      res.json(rows.map(r => ({ ...r, value: Number(r.value) })));
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      if (err?.code === 'P2021' || /pricing_rules|does not exist/i.test(msg)) {
        res.json([]);
        return;
      }
      res.status(500).json({ error: err?.message ?? 'Kurallar yüklenemedi.' });
    }
  };

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const { name, type, value, applyTo, categoryId, brand, isActive, priority } = req.body;

      const normType = normalizePriceType(type);
      if (!normType) {
        res.status(400).json({ error: 'type PERCENT veya FIXED olmalıdır.' });
        return;
      }
      if (typeof value !== 'number' || isNaN(value) || value === 0) {
        res.status(400).json({ error: 'Geçersiz value.' });
        return;
      }
      const apply = String(applyTo ?? 'ALL').toUpperCase();
      if (!['ALL', 'CATEGORY', 'BRAND'].includes(apply)) {
        res.status(400).json({ error: 'applyTo ALL, CATEGORY veya BRAND olmalıdır.' });
        return;
      }
      if (apply === 'CATEGORY' && !categoryId) {
        res.status(400).json({ error: 'Kategori kuralı için categoryId zorunludur.' });
        return;
      }
      if (apply === 'BRAND' && !brand?.trim()) {
        res.status(400).json({ error: 'Marka kuralı için brand zorunludur.' });
        return;
      }

      if (categoryId) {
        const cat = await prisma.category.findFirst({ where: { id: categoryId, tenantId } });
        if (!cat) {
          res.status(404).json({ error: 'Kategori bulunamadı.' });
          return;
        }
      }

      const storedType = normType === 'percentage' ? 'PERCENT' : 'FIXED';
      const row = await prisma.pricingRule.create({
        data: {
          tenantId,
          name:       name?.trim() || null,
          type:       storedType,
          value,
          applyTo:    apply,
          categoryId: apply === 'CATEGORY' ? categoryId : null,
          brand:      apply === 'BRAND' ? brand.trim() : null,
          isActive:   isActive !== false,
          priority:   typeof priority === 'number' ? priority : 0,
        },
        include: { category: { select: { id: true, name: true } } },
      });
      res.status(201).json({ ...row, value: Number(row.value) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Kural oluşturulamadı.' });
    }
  };

  update = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const { id } = req.params;
      const existing = await prisma.pricingRule.findFirst({ where: { id, tenantId } });
      if (!existing) {
        res.status(404).json({ error: 'Kural bulunamadı.' });
        return;
      }

      const data: Record<string, unknown> = {};
      if (req.body.name !== undefined) data.name = req.body.name?.trim() || null;
      if (req.body.type !== undefined) {
        const normType = normalizePriceType(req.body.type);
        if (!normType) {
          res.status(400).json({ error: 'type PERCENT veya FIXED olmalıdır.' });
          return;
        }
        data.type = normType === 'percentage' ? 'PERCENT' : 'FIXED';
      }
      if (req.body.value !== undefined) {
        if (typeof req.body.value !== 'number' || req.body.value === 0) {
          res.status(400).json({ error: 'Geçersiz value.' });
          return;
        }
        data.value = req.body.value;
      }
      if (req.body.applyTo !== undefined) {
        const apply = String(req.body.applyTo).toUpperCase();
        if (!['ALL', 'CATEGORY', 'BRAND'].includes(apply)) {
          res.status(400).json({ error: 'Geçersiz applyTo.' });
          return;
        }
        data.applyTo = apply;
      }
      if (req.body.categoryId !== undefined) data.categoryId = req.body.categoryId || null;
      if (req.body.brand !== undefined) data.brand = req.body.brand?.trim() || null;
      if (req.body.isActive !== undefined) data.isActive = !!req.body.isActive;
      if (req.body.priority !== undefined) data.priority = Number(req.body.priority) || 0;

      const row = await prisma.pricingRule.update({
        where:   { id },
        data,
        include: { category: { select: { id: true, name: true } } },
      });
      res.json({ ...row, value: Number(row.value) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Kural güncellenemedi.' });
    }
  };

  remove = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId;
      const { id } = req.params;
      const existing = await prisma.pricingRule.findFirst({ where: { id, tenantId } });
      if (!existing) {
        res.status(404).json({ error: 'Kural bulunamadı.' });
        return;
      }
      await prisma.pricingRule.delete({ where: { id } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Kural silinemedi.' });
    }
  };
}
