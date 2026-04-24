import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { OrderService, StockError } from './order.service';
import { AppError } from '../../common/middleware/error.middleware';
import { eventBus } from '../notifications/events';
import { auditService, AuditCategory, AuditAction } from '../audit/audit.service';
import { invoiceService } from '../../services/invoice.service';

const VALID_STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

export class OrderController {
  private orderService = new OrderService();

  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const result = await this.orderService.getAll(tenantId, {
        page:   req.query.page   as any,
        limit:  req.query.limit  as any,
        status: req.query.status as string,
        search: req.query.search as string,
      });

      res.status(200).json({ status: 'success', data: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Siparişler alınamadı.' });
    }
  };

  getById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id       = req.params.id;
      const tenantId = req.user!.tenantId!;

      const order = await this.orderService.getById(id, tenantId);
      if (!order) {
        res.status(404).json({ error: 'Sipariş bulunamadı.' });
        return;
      }

      res.status(200).json({ status: 'success', data: order });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Sipariş alınamadı.' });
    }
  };

  create = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const result   = await this.orderService.create(req.body, tenantId);

      // Service now returns { order, summary, appliedCampaigns }
      const order = result.order;

      // Fire-and-forget events
      const customer = (order as any).customer;
      eventBus.emit('ORDER_CREATED', {
        tenantId,
        orderId:       order.id,
        orderNumber:   order.orderNumber,
        totalAmount:   Number(order.totalAmount),
        currency:      order.currency,
        customerEmail: customer?.email ?? '',
        customerName:  `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}`.trim() || 'Müşteri',
        items: ((order as any).items ?? []).map((i: any) => ({
          name:     i.product?.name ?? i.productId,
          quantity: i.quantity,
          price:    Number(i.price),
        })),
      });

      auditService.log({
        userId:    req.user!.id,
        userEmail: req.user!.email,
        userRole:  req.user!.role,
        tenantId,
        action:    AuditAction.ORDER_CREATED,
        category:  AuditCategory.ORDER,
        targetType: 'Order', targetId: order.id,
        targetName: order.orderNumber,
        details:   { totalAmount: Number(order.totalAmount), currency: order.currency },
        req,
      }).catch(() => {});

      res.status(201).json({
        status: 'success',
        data: {
          order,
          summary:          result.summary,
          appliedCampaigns: result.appliedCampaigns,
        },
      });
    } catch (err: any) {
      if (err instanceof StockError) {
        res.status(422).json({ error: err.message, meta: err.meta });
        return;
      }
      res.status(500).json({ error: err.message ?? 'Sipariş oluşturulamadı.' });
    }
  };

  updateStatus = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id       = req.params.id;
      const tenantId = req.user!.tenantId!;
      const { status } = req.body;

      if (!status) {
        res.status(400).json({ error: 'status alanı zorunludur.' });
        return;
      }

      const normalized = String(status).toUpperCase();
      if (!VALID_STATUSES.includes(normalized)) {
        res.status(400).json({
          error: `Geçersiz status. Geçerli değerler: ${VALID_STATUSES.join(', ')}`,
        });
        return;
      }

      const order = await this.orderService.updateStatus(id, normalized, tenantId);

      // Auto-generate invoice when order is completed
      if (normalized === 'COMPLETED') {
        try {
          await invoiceService.processOrderCompletion(id);
        } catch (invoiceError) {
          // Log error but don't fail the order status update
          console.error('Failed to generate invoice for completed order:', invoiceError);
        }
      }

      eventBus.emit('ORDER_STATUS_CHANGED', {
        tenantId,
        orderId:       id,
        orderNumber:   order.orderNumber,
        newStatus:     normalized,
        customerEmail: (order as any).customer?.email ?? '',
        customerName:  (order as any).customer
          ? `${(order as any).customer.firstName} ${(order as any).customer.lastName}`.trim()
          : '',
      });

      auditService.log({
        userId:    req.user!.id,
        userEmail: req.user!.email,
        userRole:  req.user!.role,
        tenantId,
        action:    AuditAction.ORDER_STATUS_CHANGED,
        category:  AuditCategory.ORDER,
        targetType: 'Order', targetId: id,
        targetName: order.orderNumber,
        details:   { newStatus: normalized },
        req,
      }).catch(() => {});

      res.status(200).json({ status: 'success', data: order });
    } catch (err: any) {
      if (err instanceof StockError) {
        res.status(422).json({ error: err.message, meta: err.meta });
        return;
      }
      const is404 = err.message?.includes('bulunamadı');
      res.status(is404 ? 404 : 500).json({ error: err.message ?? 'Status güncellenemedi.' });
    }
  };

  delete = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id       = req.params.id;
      const tenantId = req.user!.tenantId!;

      await this.orderService.delete(id, tenantId);

      auditService.log({
        userId:    req.user!.id,
        userEmail: req.user!.email,
        userRole:  req.user!.role,
        tenantId,
        action:    AuditAction.ORDER_DELETED,
        category:  AuditCategory.ORDER,
        targetType: 'Order', targetId: id,
        req,
      }).catch(() => {});

      res.status(204).send();
    } catch (err: any) {
      if (err instanceof StockError) {
        res.status(422).json({ error: err.message, meta: err.meta });
        return;
      }
      const is404 = err.message?.includes('bulunamadı');
      res.status(is404 ? 404 : 500).json({ error: err.message ?? 'Sipariş silinemedi.' });
    }
  };

  getByCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const customerId = req.params.customerId;
      const tenantId   = req.user!.tenantId!;
      const orders     = await this.orderService.getByCustomer(customerId, tenantId);
      res.status(200).json({ status: 'success', data: orders });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Siparişler alınamadı.' });
    }
  };

  getStats = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const stats    = await this.orderService.getStats(tenantId);
      res.status(200).json({ status: 'success', data: stats });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'İstatistikler alınamadı.' });
    }
  };
}
