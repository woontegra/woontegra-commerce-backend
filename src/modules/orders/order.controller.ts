import { Response } from 'express';
import { AuthRequest } from '../../common/middleware/auth.middleware';
import { OrderService, StockError } from './order.service';
import { AppError } from '../../common/middleware/error.middleware';
import { eventBus } from '../notifications/events';
import { auditService, AuditCategory, AuditAction } from '../audit/audit.service';
import { invoiceService } from '../../services/invoice.service';
import { toAdminOrderJson } from './order-admin.presenter';
import { parseOrderListQuery } from './order-list.query';
import { orderInvoicePdfUploader, orderInvoicePublicUrl } from './order-invoice.upload';

const VALID_STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

export class OrderController {
  private orderService = new OrderService();

  getAll = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user!.tenantId!;
      const parsed = parseOrderListQuery(req.query as Record<string, unknown>);
      if (!parsed.ok) {
        res.status(400).json({ error: `Geçersiz sorgu parametreleri: ${parsed.error}` });
        return;
      }

      const result = await this.orderService.getAllUnified(tenantId, {
        page:            parsed.data.page,
        limit:           parsed.data.limit,
        status:          parsed.data.status,
        search:          parsed.data.search,
        paymentProvider: parsed.data.paymentProvider,
        paymentStatus:   parsed.data.paymentStatus,
        source:          parsed.data.source,
      });

      res.status(200).json({
        status: 'success',
        data: {
          orders:     result.orders,
          total:      result.total,
          page:       result.page,
          totalPages: result.totalPages,
        },
      });
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

      res.status(200).json({ status: 'success', data: toAdminOrderJson(order as never) });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Sipariş alınamadı.' });
    }
  };

  getHistory = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id       = req.params.id;
      const tenantId = req.user!.tenantId!;

      const history = await this.orderService.getHistory(id, tenantId);
      if (history === null) {
        res.status(404).json({ error: 'Sipariş bulunamadı.' });
        return;
      }

      res.status(200).json({ status: 'success', data: history });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Sipariş geçmişi alınamadı.' });
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
      if (err?.statusCode === 422) {
        res.status(422).json({ error: err.message ?? 'İstek reddedildi.' });
        return;
      }
      res.status(500).json({ error: err.message ?? 'Sipariş oluşturulamadı.' });
    }
  };

  uploadInvoicePdf = (req: AuthRequest, res: Response): void => {
    orderInvoicePdfUploader(req, res, async (err: unknown) => {
      if (err) {
        const msg =
          err instanceof Error
            ? err.message.includes('File too large')
              ? 'Dosya boyutu en fazla 5 MB olabilir.'
              : err.message
            : 'Fatura PDF yüklenemedi.';
        res.status(400).json({ error: msg });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'PDF dosyası seçilmedi.' });
        return;
      }

      try {
        const id       = req.params.id;
        const tenantId = req.user!.tenantId!;

        const existing = await this.orderService.getById(id, tenantId);
        if (!existing) {
          res.status(404).json({ error: 'Sipariş bulunamadı.' });
          return;
        }

        const invoiceUrl = orderInvoicePublicUrl(tenantId, req.file.filename);
        const order = await this.orderService.updateInvoice(id, tenantId, { invoiceUrl });

        auditService.log({
          userId:    req.user!.id,
          userEmail: req.user!.email,
          userRole:  req.user!.role,
          tenantId,
          action:    AuditAction.ORDER_UPDATED,
          category:  AuditCategory.ORDER,
          targetType: 'Order',
          targetId:   id,
          targetName: order.orderNumber,
          details: {
            invoicePdfUploaded: true,
            invoiceNumber:      order.invoiceNumber ?? null,
            hasInvoiceUrl:      true,
            fileName:             req.file.originalname,
          },
          req,
        }).catch(() => {});

        res.status(200).json({ status: 'success', data: toAdminOrderJson(order as never) });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Fatura PDF yüklenemedi.';
        const is404 = msg.includes('bulunamadı');
        res.status(is404 ? 404 : 400).json({ error: msg });
      }
    });
  };

  updateInvoice = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id       = req.params.id;
      const tenantId = req.user!.tenantId!;
      const { invoiceNumber, invoiceUrl } = req.body ?? {};

      if (invoiceNumber === undefined && invoiceUrl === undefined) {
        res.status(400).json({ error: 'En az bir alan gönderilmelidir: invoiceNumber veya invoiceUrl.' });
        return;
      }

      const existing = await this.orderService.getById(id, tenantId);
      if (!existing) {
        res.status(404).json({ error: 'Sipariş bulunamadı.' });
        return;
      }

      const order = await this.orderService.updateInvoice(id, tenantId, {
        ...(invoiceNumber !== undefined ? { invoiceNumber } : {}),
        ...(invoiceUrl !== undefined ? { invoiceUrl } : {}),
      });

      auditService.log({
        userId:    req.user!.id,
        userEmail: req.user!.email,
        userRole:  req.user!.role,
        tenantId,
        action:    AuditAction.ORDER_UPDATED,
        category:  AuditCategory.ORDER,
        targetType: 'Order',
        targetId:   id,
        targetName: order.orderNumber,
        details: {
          invoiceUpdated: true,
          invoiceNumber:  order.invoiceNumber ?? null,
          hasInvoiceUrl:  Boolean(order.invoiceUrl),
        },
        req,
      }).catch(() => {});

      res.status(200).json({ status: 'success', data: toAdminOrderJson(order as never) });
    } catch (err: any) {
      const is404 = err.message?.includes('bulunamadı');
      const is400 = err.message?.includes('http://') || err.message?.includes('https://');
      res.status(is404 ? 404 : is400 ? 400 : 500).json({
        error: err.message ?? 'Fatura bilgileri kaydedilemedi.',
      });
    }
  };

  updateShipping = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id       = req.params.id;
      const tenantId = req.user!.tenantId!;
      const { shippingCarrier, shippingTrackingNumber, shippingTrackingUrl, markAsShipped } =
        req.body ?? {};

      const order = await this.orderService.updateShipping(id, tenantId, {
        shippingCarrier,
        shippingTrackingNumber,
        shippingTrackingUrl,
        markAsShipped: Boolean(markAsShipped),
      });

      if (!order) {
        res.status(404).json({ error: 'Sipariş bulunamadı.' });
        return;
      }

      res.status(200).json({ status: 'success', data: toAdminOrderJson(order as never) });
    } catch (err: any) {
      if (err instanceof StockError) {
        res.status(422).json({ error: err.message, meta: err.meta });
        return;
      }
      const is404 = err.message?.includes('bulunamadı');
      const is400 = err.message?.includes('http://') || err.message?.includes('https://');
      res.status(is404 ? 404 : is400 ? 400 : 500).json({
        error: err.message ?? 'Kargo bilgileri kaydedilemedi.',
      });
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

      const existing = await this.orderService.getById(id, tenantId);
      if (!existing) {
        res.status(404).json({ error: 'Sipariş bulunamadı.' });
        return;
      }
      const previousStatus = String(existing.status);

      const order = await this.orderService.updateStatus(id, normalized, tenantId, {
        notifyCustomer: true,
      });

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
        details:   { newStatus: normalized, previousStatus },
        req,
      }).catch(() => {});

      res.status(200).json({ status: 'success', data: toAdminOrderJson(order as never) });
    } catch (err: any) {
      if (err instanceof StockError) {
        res.status(422).json({ error: err.message, meta: err.meta });
        return;
      }
      const is404 = err.message?.includes('bulunamadı');
      res.status(is404 ? 404 : 500).json({ error: err.message ?? 'Status güncellenemedi.' });
    }
  };

  confirmPayment = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id       = req.params.id;
      const tenantId = req.user!.tenantId!;

      const existing = await this.orderService.getById(id, tenantId);
      if (!existing) {
        res.status(404).json({ error: 'Sipariş bulunamadı.' });
        return;
      }

      const oldStatus        = String(existing.status);
      const oldPaymentStatus = existing.paymentStatus ?? null;

      const order = await this.orderService.confirmPayment(id, tenantId);
      const newStatus = String(order.status);

      if (newStatus !== oldStatus) {
        eventBus.emit('ORDER_STATUS_CHANGED', {
          tenantId,
          orderId:       id,
          orderNumber:   order.orderNumber,
          newStatus,
          customerEmail: (order as any).customer?.email ?? '',
          customerName:  (order as any).customer
            ? `${(order as any).customer.firstName} ${(order as any).customer.lastName}`.trim()
            : '',
        });
      }

      auditService.log({
        userId:    req.user!.id,
        userEmail: req.user!.email,
        userRole:  req.user!.role,
        tenantId,
        action:    AuditAction.ORDER_UPDATED,
        category:  AuditCategory.ORDER,
        targetType: 'Order',
        targetId:   id,
        targetName: order.orderNumber,
        details: {
          paymentConfirmed:    true,
          previousPaymentStatus: oldPaymentStatus,
          paymentStatus:       order.paymentStatus,
          previousOrderStatus: oldStatus,
          orderStatus:         newStatus,
        },
        req,
      }).catch(() => {});

      res.status(200).json({ status: 'success', data: toAdminOrderJson(order as never) });
    } catch (err: any) {
      const statusCode = err.statusCode ?? (err.message?.includes('bulunamadı') ? 404 : 500);
      res.status(statusCode).json({ error: err.message ?? 'Ödeme onaylanamadı.' });
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
