import prisma from '../../config/database';
import type { OrderStatus, ReturnRequestStatus, ReturnRequestType } from '@prisma/client';
import { OrderService } from '../orders/order.service';
import { returnRefundService } from './return-refund.service';
import { storeEmailService } from '../store-public/store-email.service';
import { eventBus } from '../notifications/events';

const orderService = new OrderService();

export type ReturnStatusSyncResult = {
  orderSynced: boolean;
  orderStatus?: string;
  message?: string;
  stockRestored?: boolean;
  stockAlreadyRestored?: boolean;
};

const CANCELLABLE_ORDER_STATUSES: OrderStatus[] = ['PENDING', 'PROCESSING', 'PAID'];

export const ACTIVE_RETURN_STATUSES: ReturnRequestStatus[] = ['PENDING', 'APPROVED'];

const RETURN_INCLUDE = {
  items: {
    include: {
      orderItem: {
        include: {
          product: { select: { id: true, name: true, slug: true } },
          variant: { select: { id: true, name: true } },
        },
      },
    },
  },
  order:    { select: { id: true, orderNumber: true, status: true, totalAmount: true, currency: true } },
  customer: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
} as const;

function genRequestNumber(): string {
  return `RTN-${Date.now().toString(36).toUpperCase().slice(-10)}`;
}

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

export function mapReturnRequest(row: {
  id: string;
  requestNumber: string;
  tenantId: string;
  orderId: string;
  customerId: string;
  type: ReturnRequestType;
  status: ReturnRequestStatus;
  reason: string;
  customerNote: string | null;
  adminNote: string | null;
  stockRestoredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  order?: { id: string; orderNumber: string; status: OrderStatus; totalAmount?: unknown; currency?: string };
  customer?: { id: string; email: string; firstName: string; lastName: string; phone: string | null };
  items?: Array<{
    id: string;
    orderItemId: string;
    quantity: number;
    reason: string | null;
    orderItem?: {
      quantity: number;
      price: unknown;
      product: { id: string; name: string; slug: string } | null;
      variant: { id: string; name: string } | null;
    };
  }>;
}) {
  return {
    id:            row.id,
    requestNumber: row.requestNumber,
    tenantId:      row.tenantId,
    orderId:       row.orderId,
    customerId:    row.customerId,
    type:          row.type,
    status:        row.status,
    reason:        row.reason,
    customerNote:  row.customerNote,
    adminNote:       row.adminNote,
    stockRestoredAt: row.stockRestoredAt,
    createdAt:       row.createdAt,
    updatedAt:       row.updatedAt,
    order: row.order
      ? {
          id:          row.order.id,
          orderNumber: row.order.orderNumber,
          status:      row.order.status,
          totalAmount: row.order.totalAmount != null ? num(row.order.totalAmount) : undefined,
          currency:    'currency' in row.order && row.order.currency
            ? String(row.order.currency)
            : undefined,
        }
      : undefined,
    customer: row.customer
      ? {
          id:        row.customer.id,
          email:     row.customer.email,
          firstName: row.customer.firstName,
          lastName:  row.customer.lastName,
          phone:     row.customer.phone ?? '',
        }
      : undefined,
    items: (row.items ?? []).map(i => ({
      id:          i.id,
      orderItemId: i.orderItemId,
      quantity:    i.quantity,
      reason:      i.reason,
      productName: i.orderItem?.product?.name ?? 'Ürün',
      productSlug: i.orderItem?.product?.slug,
      variantName: i.orderItem?.variant?.name,
      orderQuantity: i.orderItem?.quantity,
      linePrice:     i.orderItem?.price != null ? num(i.orderItem.price) : undefined,
    })),
  };
}

const CANCEL_REQUEST_ORDER_STATUSES: OrderStatus[] = ['PENDING', 'PROCESSING', 'PAID'];

function assertCancelAllowed(status: OrderStatus) {
  if (status === 'CANCELLED') {
    throw new Error('Sipariş zaten iptal edilmiş.');
  }
  if (!CANCEL_REQUEST_ORDER_STATUSES.includes(status)) {
    if (status === 'SHIPPED') {
      throw new Error(
        'Siparişiniz kargoya verildiği için iptal talebi yerine teslimat sonrası iade talebi oluşturabilirsiniz.',
      );
    }
    if (status === 'DELIVERED') {
      throw new Error('Teslim edilmiş siparişler için iade talebi oluşturun.');
    }
    throw new Error('Bu sipariş durumunda iptal talebi açılamaz.');
  }
}

function assertReturnAllowed(status: OrderStatus) {
  if (status === 'CANCELLED') {
    throw new Error('Sipariş iptal edilmiş.');
  }
  if (CANCEL_REQUEST_ORDER_STATUSES.includes(status)) {
    throw new Error('Henüz kargoya verilmeyen siparişler için iptal talebi oluşturun.');
  }
  if (status === 'SHIPPED') {
    throw new Error(
      'Siparişiniz kargoya verildiği için iptal talebi yerine teslimat sonrası iade talebi oluşturabilirsiniz.',
    );
  }
  if (status !== 'DELIVERED') {
    throw new Error('İade talebi yalnızca teslim edilmiş siparişler için oluşturulabilir.');
  }
}

export class ReturnRequestService {
  async listByTenant(tenantId: string, opts?: { status?: string; page?: number; limit?: number }) {
    const page  = Math.max(1, opts?.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
    const where: { tenantId: string; status?: ReturnRequestStatus } = { tenantId };
    if (opts?.status && ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'].includes(opts.status)) {
      where.status = opts.status as ReturnRequestStatus;
    }

    const [total, rows] = await Promise.all([
      prisma.orderReturnRequest.count({ where }),
      prisma.orderReturnRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
        include: RETURN_INCLUDE,
      }),
    ]);

    return {
      items: rows.map(r => mapReturnRequest(r as never)),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async listByCustomer(tenantId: string, customerId: string) {
    const rows = await prisma.orderReturnRequest.findMany({
      where:   { tenantId, customerId },
      orderBy: { createdAt: 'desc' },
      include: RETURN_INCLUDE,
    });
    return rows.map(r => mapReturnRequest(r as never));
  }

  async listByOrder(tenantId: string, orderId: string) {
    const rows = await prisma.orderReturnRequest.findMany({
      where:   { tenantId, orderId },
      orderBy: { createdAt: 'desc' },
      include: RETURN_INCLUDE,
    });
    return rows.map(r => mapReturnRequest(r as never));
  }

  async getActiveForOrderByNumber(tenantId: string, customerId: string, orderNumber: string) {
    const order = await prisma.order.findFirst({
      where: { tenantId, customerId, orderNumber },
      select: { id: true },
    });
    if (!order) return null;
    return this.getActiveForOrder(tenantId, customerId, order.id);
  }

  async getActiveForOrder(tenantId: string, customerId: string, orderId: string) {
    const row = await prisma.orderReturnRequest.findFirst({
      where: {
        tenantId,
        customerId,
        orderId,
        status: { in: ACTIVE_RETURN_STATUSES },
      },
      include: RETURN_INCLUDE,
    });
    return row ? mapReturnRequest(row as never) : null;
  }

  async getByIdForTenant(id: string, tenantId: string) {
    const row = await prisma.orderReturnRequest.findFirst({
      where: { id, tenantId },
      include: RETURN_INCLUDE,
    });
    return row ? mapReturnRequest(row as never) : null;
  }

  async getByIdForCustomer(id: string, tenantId: string, customerId: string) {
    const row = await prisma.orderReturnRequest.findFirst({
      where: { id, tenantId, customerId },
      include: RETURN_INCLUDE,
    });
    if (!row) return null;
    const refunds = await returnRefundService.getPublicRefundsForCustomer(id, tenantId, customerId);
    return { ...mapReturnRequest(row as never), refunds };
  }

  async createForCustomer(
    tenantId: string,
    customerId: string,
    orderNumber: string,
    body: {
      type: ReturnRequestType;
      reason: string;
      customerNote?: string;
      items?: Array<{ orderItemId: string; quantity: number; reason?: string }>;
    },
  ) {
    const order = await prisma.order.findFirst({
      where: { tenantId, customerId, orderNumber },
      include: { items: true },
    });
    if (!order) {
      throw new Error('Sipariş bulunamadı.');
    }

    const active = await prisma.orderReturnRequest.findFirst({
      where: {
        tenantId,
        orderId: order.id,
        status:  { in: ACTIVE_RETURN_STATUSES },
      },
    });
    if (active) {
      throw new Error('Bu sipariş için zaten bekleyen veya onaylanmış bir talep var.');
    }

    if (body.type === 'CANCEL_REQUEST') {
      assertCancelAllowed(order.status);
    } else {
      assertReturnAllowed(order.status);
    }

    const itemRows = body.items ?? [];
    if (body.type === 'RETURN_REQUEST') {
      if (itemRows.length === 0) {
        throw new Error('İade talebi için en az bir ürün seçmelisiniz.');
      }
      const orderItemIds = new Set(order.items.map(i => i.id));
      for (const it of itemRows) {
        if (!orderItemIds.has(it.orderItemId)) {
          throw new Error('Seçilen ürün bu siparişe ait değil.');
        }
        const oi = order.items.find(i => i.id === it.orderItemId)!;
        if (it.quantity < 1 || it.quantity > oi.quantity) {
          throw new Error(`Geçersiz adet: ${oi.id}`);
        }
      }
    }

    const created = await prisma.orderReturnRequest.create({
      data: {
        requestNumber: genRequestNumber(),
        tenantId,
        orderId:       order.id,
        customerId,
        type:          body.type,
        reason:        body.reason.trim(),
        customerNote:  body.customerNote?.trim() || null,
        items:
          body.type === 'RETURN_REQUEST'
            ? {
                create: itemRows.map(it => ({
                  orderItemId: it.orderItemId,
                  quantity:    it.quantity,
                  reason:      it.reason?.trim() || null,
                })),
              }
            : undefined,
      },
      include: RETURN_INCLUDE,
    });

    void storeEmailService.notifyReturnRequestCreated(tenantId, created.id);

    eventBus.emit('RETURN_REQUEST_CREATED', {
      tenantId,
      returnRequestId: created.id,
      requestNumber:   created.requestNumber,
      orderNumber:     order.orderNumber,
      type:            body.type,
    });

    return mapReturnRequest(created as never);
  }

  private async appendReturnApprovalNote(orderId: string, requestNumber: string) {
    const order = await prisma.order.findUnique({
      where:  { id: orderId },
      select: { notes: true },
    });
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const line = `[${stamp}] İade talebi onaylandı (${requestNumber})`;
    const notes = order?.notes?.trim() ? `${order.notes.trim()}\n${line}` : line;
    await prisma.order.update({
      where: { id: orderId },
      data:  { notes },
    });
  }

  private async applyApprovalSideEffects(
    existing: {
      id: string;
      orderId: string;
      type: ReturnRequestType;
      status: ReturnRequestStatus;
      requestNumber: string;
    },
    tenantId: string,
  ): Promise<ReturnStatusSyncResult> {
    const order = await prisma.order.findFirst({
      where:  { id: existing.orderId, tenantId },
      select: { id: true, status: true },
    });
    if (!order) {
      throw new Error('İlişkili sipariş bulunamadı.');
    }

    if (existing.type === 'CANCEL_REQUEST') {
      if (['SHIPPED', 'DELIVERED'].includes(order.status)) {
        throw new Error(
          'Kargoya verilmiş veya teslim edilmiş siparişler için iptal talebi onaylanamaz.',
        );
      }
      if (order.status === 'CANCELLED') {
        return {
          orderSynced: false,
          orderStatus: 'CANCELLED',
          message: 'Sipariş zaten iptal edilmiş.',
        };
      }
      if (!CANCELLABLE_ORDER_STATUSES.includes(order.status)) {
        throw new Error('Bu sipariş durumunda iptal talebi onaylanamaz.');
      }

      await orderService.updateStatus(order.id, 'CANCELLED', tenantId, { notifyCustomer: true });
      return {
        orderSynced: true,
        orderStatus: 'CANCELLED',
        message: 'Sipariş iptal edildi; stok iadesi mevcut sipariş servisi ile yapıldı.',
      };
    }

    if (existing.type === 'RETURN_REQUEST') {
      await this.appendReturnApprovalNote(order.id, existing.requestNumber);
      return {
        orderSynced: false,
        orderStatus: order.status,
        message: 'İade talebi onaylandı. Sipariş durumu değiştirilmedi.',
      };
    }

    return { orderSynced: false };
  }

  private async restoreReturnRequestStock(
    requestId: string,
    tenantId: string,
  ): Promise<ReturnStatusSyncResult> {
    const request = await prisma.orderReturnRequest.findFirst({
      where: { id: requestId, tenantId, type: 'RETURN_REQUEST' },
      include: {
        items: {
          include: {
            orderItem: {
              select: {
                id: true,
                quantity: true,
                productId: true,
                variantId: true,
                orderId: true,
              },
            },
          },
        },
        order: { select: { tenantId: true } },
      },
    });

    if (!request) {
      throw new Error('Talep bulunamadı.');
    }
    if (request.order.tenantId !== tenantId) {
      throw new Error('Talep bulunamadı.');
    }
    if (request.stockRestoredAt) {
      return {
        orderSynced: false,
        stockAlreadyRestored: true,
        message: 'Bu talep için stok iadesi daha önce yapılmış.',
      };
    }
    if (request.items.length === 0) {
      throw new Error('İade talebinde stok iadesi için ürün kalemi bulunamadı.');
    }

    for (const item of request.items) {
      const oi = item.orderItem;
      if (!oi) {
        throw new Error('Talep kalemi sipariş satırıyla eşleşmiyor.');
      }
      if (item.quantity < 1 || item.quantity > oi.quantity) {
        throw new Error('İade adedi sipariş kalemindeki adetten fazla olamaz.');
      }
    }

    const txResult = await prisma.$transaction(async tx => {
      const locked = await tx.orderReturnRequest.findFirst({
        where: { id: requestId, tenantId },
        select: { stockRestoredAt: true },
      });
      if (locked?.stockRestoredAt) {
        return { restored: false as const };
      }

      for (const item of request.items) {
        const oi = item.orderItem!;
        if (oi.variantId) {
          await tx.productVariant.updateMany({
            where: { id: oi.variantId },
            data:  { stockQuantity: { increment: item.quantity } },
          });
        } else {
          await tx.stock.updateMany({
            where: { productId: oi.productId },
            data:  { quantity: { increment: item.quantity } },
          });
        }
      }

      await tx.orderReturnRequest.update({
        where: { id: requestId },
        data:  { stockRestoredAt: new Date() },
      });
      return { restored: true as const };
    });

    if (!txResult.restored) {
      return {
        orderSynced: false,
        stockAlreadyRestored: true,
        message: 'Bu talep için stok iadesi daha önce yapılmış.',
      };
    }

    return {
      orderSynced: false,
      stockRestored: true,
      message: 'İade talebi tamamlandı; seçili ürünler stoğa eklendi.',
    };
  }

  private async applyCompletionSideEffects(
    existing: {
      id: string;
      type: ReturnRequestType;
      status: ReturnRequestStatus;
      stockRestoredAt: Date | null;
    },
    tenantId: string,
    newStatus: ReturnRequestStatus,
  ): Promise<ReturnStatusSyncResult> {
    if (existing.type !== 'RETURN_REQUEST' || newStatus !== 'COMPLETED') {
      return { orderSynced: false };
    }

    if (existing.status !== 'APPROVED') {
      throw new Error('İade talebi tamamlanmadan önce onaylanmalıdır.');
    }

    return this.restoreReturnRequestStock(existing.id, tenantId);
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: ReturnRequestStatus,
    adminNote?: string,
  ) {
    const valid: ReturnRequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'];
    if (!valid.includes(status)) {
      throw new Error('Geçersiz talep durumu.');
    }

    const existing = await prisma.orderReturnRequest.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      throw new Error('Talep bulunamadı.');
    }

    if (
      existing.type === 'RETURN_REQUEST' &&
      status === 'COMPLETED' &&
      existing.status !== 'APPROVED' &&
      existing.status !== 'COMPLETED'
    ) {
      throw new Error('İade talebi tamamlanmadan önce onaylanmalıdır.');
    }

    const isNewApproval = status === 'APPROVED' && existing.status !== 'APPROVED';
    const isNewCompletion =
      status === 'COMPLETED' &&
      existing.status !== 'COMPLETED' &&
      existing.type === 'RETURN_REQUEST';

    let sync: ReturnStatusSyncResult = { orderSynced: false };

    if (isNewApproval) {
      sync = await this.applyApprovalSideEffects(existing, tenantId);
    }

    if (isNewCompletion) {
      const completionSync = await this.applyCompletionSideEffects(existing, tenantId, status);
      sync = { ...sync, ...completionSync };
    }

    const updated = await prisma.orderReturnRequest.update({
      where: { id },
      data: {
        status,
        ...(adminNote !== undefined ? { adminNote: adminNote.trim() || null } : {}),
      },
      include: RETURN_INCLUDE,
    });

    void storeEmailService.notifyReturnRequestStatusChanged(
      tenantId,
      id,
      existing.status,
      status,
      adminNote !== undefined ? adminNote : updated.adminNote,
    );

    return { ...mapReturnRequest(updated as never), sync };
  }
}

export const returnRequestService = new ReturnRequestService();
