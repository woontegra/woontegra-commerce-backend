import prisma from '../../config/database';
import { buildAdminOrderMeta } from '../orders/order-admin.presenter';
import { returnRequestService } from '../returns/return-request.service';
import { tenantPaymentSettingsService } from '../payments/tenant-payment-settings.service';
import {
  buildCustomerBankTransferPayment,
  buildCustomerOrderPayment,
  pickCustomerReturnRequestPublic,
  pickCustomerShippingFields,
  shouldShowCustomerBankTransferPayment,
} from './store-account.presenter';
import {
  buildPaginationMeta,
  buildStoreAccountOrdersWhere,
  STORE_ACCOUNT_DEFAULT_LIMIT,
  STORE_ACCOUNT_DEFAULT_PAGE,
  type StoreAccountOrdersListQuery,
} from './store-account-orders-query.util';

export type StoreAccountOrderSummary = {
  total:          number;
  waitingPayment: number;
  processing:     number;
  shipped:        number;
  delivered:      number;
  cancelled:      number;
};

const SUMMARY_LIST_QUERY_STUB: StoreAccountOrdersListQuery = {
  page:  STORE_ACCOUNT_DEFAULT_PAGE,
  limit: STORE_ACCOUNT_DEFAULT_LIMIT,
};

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v && typeof (v as { toNumber: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const ORDER_LIST_INCLUDE = {
  items: {
    include: {
      product: { select: { id: true, name: true } },
      variant: { select: { id: true, name: true } },
    },
    take: 3,
  },
  paymentSessions: {
    select: { provider: true, status: true },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
} as const;

export class StoreAccountService {
  async listOrders(
    tenantId: string,
    customerId: string,
    listQuery: StoreAccountOrdersListQuery = {},
  ) {
    const where = buildStoreAccountOrdersWhere(tenantId, customerId, listQuery);
    const page  = listQuery.page;
    const limit = listQuery.limit;
    const skip  = (page - 1) * limit;

    const [total, rows] = await prisma.$transaction([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
        include: ORDER_LIST_INCLUDE,
      }),
    ]);

    const orders = rows.map(o => {
      const payment = buildCustomerOrderPayment(o);
      return {
        id:          o.id,
        orderNumber: o.orderNumber,
        status:      o.status,
        totalAmount: num(o.totalAmount),
        currency:    o.currency,
        createdAt:     o.createdAt,
        itemCount:     o.items.length,
        paymentProvider:     payment.provider,
        paymentStatus:       payment.status,
        paymentApprovedAt:   payment.approvedAt,
        paymentFailedAt:     payment.failedAt,
        paymentMethod:       payment.providerLabel,
        paymentStatusLabel:  payment.statusLabel,
        shippingPrice: num(o.shippingPrice),
        ...pickCustomerShippingFields(o),
      };
    });

    return {
      orders,
      pagination: buildPaginationMeta(total, page, limit),
    };
  }

  async getOrdersSummary(
    tenantId: string,
    customerId: string,
  ): Promise<StoreAccountOrderSummary> {
    const baseWhere = { tenantId, customerId };
    const [
      total,
      waitingPayment,
      processing,
      shipped,
      delivered,
      cancelled,
    ] = await Promise.all([
      prisma.order.count({ where: baseWhere }),
      prisma.order.count({
        where: buildStoreAccountOrdersWhere(tenantId, customerId, {
          ...SUMMARY_LIST_QUERY_STUB,
          filter: 'WAITING_PAYMENT',
        }),
      }),
      prisma.order.count({
        where: buildStoreAccountOrdersWhere(tenantId, customerId, {
          ...SUMMARY_LIST_QUERY_STUB,
          status: 'PROCESSING',
        }),
      }),
      prisma.order.count({
        where: buildStoreAccountOrdersWhere(tenantId, customerId, {
          ...SUMMARY_LIST_QUERY_STUB,
          status: 'SHIPPED',
        }),
      }),
      prisma.order.count({
        where: buildStoreAccountOrdersWhere(tenantId, customerId, {
          ...SUMMARY_LIST_QUERY_STUB,
          status: 'DELIVERED',
        }),
      }),
      prisma.order.count({
        where: buildStoreAccountOrdersWhere(tenantId, customerId, {
          ...SUMMARY_LIST_QUERY_STUB,
          status: 'CANCELLED',
        }),
      }),
    ]);

    return { total, waitingPayment, processing, shipped, delivered, cancelled };
  }

  async getOrderByNumber(tenantId: string, customerId: string, orderNumber: string) {
    const o = await prisma.order.findFirst({
      where: { tenantId, customerId, orderNumber },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, slug: true } },
            variant: { select: { id: true, name: true, sku: true } },
          },
        },
        paymentSessions: {
          select: { id: true, provider: true, status: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!o) return null;

    const meta = buildAdminOrderMeta(o as never);
    const activeReturnRequest = await returnRequestService.getActiveForOrder(
      tenantId,
      customerId,
      o.id,
    );

    let bankTransferPayment = null;
    if (shouldShowCustomerBankTransferPayment(o)) {
      const bankDetails = await tenantPaymentSettingsService.getActiveBankTransferDetails(tenantId);
      bankTransferPayment = buildCustomerBankTransferPayment(o.orderNumber, bankDetails);
    }

    return {
      id:          o.id,
      orderNumber: o.orderNumber,
      status:      o.status,
      currency:    o.currency,
      createdAt:     o.createdAt,
      notes:         o.notes,
      payment:       buildCustomerOrderPayment(o),
      bankTransferPayment,
      totals:        meta.totals,
      shippingAddress: meta.shippingAddress,
      items: o.items.map(i => ({
        id:       i.id,
        quantity: i.quantity,
        price:    num(i.price),
        lineTotal: Math.round(num(i.price) * i.quantity * 100) / 100,
        product:  i.product,
        variant:  i.variant,
      })),
      activeReturnRequest: pickCustomerReturnRequestPublic(
        activeReturnRequest as never,
      ),
      ...pickCustomerShippingFields(o),
    };
  }

  async updateProfile(
    tenantId: string,
    customerId: string,
    data: { firstName: string; lastName: string; phone: string },
  ) {
    const existing = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
    });
    if (!existing) throw new Error('Müşteri bulunamadı.');

    return prisma.customer.update({
      where: { id: customerId },
      data: {
        firstName: data.firstName.trim(),
        lastName:  data.lastName.trim(),
        phone:     data.phone.trim() || null,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
      },
    });
  }

  async listAddresses(tenantId: string, customerId: string) {
    return prisma.customerAddress.findMany({
      where:   { tenantId, customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createAddress(
    tenantId: string,
    customerId: string,
    data: {
      title: string;
      fullName: string;
      phone: string;
      city: string;
      district: string;
      addressLine: string;
      postalCode: string;
      isDefault: boolean;
    },
  ) {
    if (data.isDefault) {
      await prisma.customerAddress.updateMany({
        where: { tenantId, customerId },
        data:  { isDefault: false },
      });
    }

    return prisma.customerAddress.create({
      data: {
        tenantId,
        customerId,
        title:       data.title,
        fullName:    data.fullName,
        phone:       data.phone,
        city:        data.city,
        district:    data.district,
        addressLine: data.addressLine,
        postalCode:  data.postalCode || null,
        isDefault:   data.isDefault,
      },
    });
  }

  async updateAddress(
    tenantId: string,
    customerId: string,
    addressId: string,
    data: Partial<{
      title: string;
      fullName: string;
      phone: string;
      city: string;
      district: string;
      addressLine: string;
      postalCode: string;
      isDefault: boolean;
    }>,
  ) {
    const existing = await prisma.customerAddress.findFirst({
      where: { id: addressId, tenantId, customerId },
    });
    if (!existing) throw new Error('Adres bulunamadı.');

    if (data.isDefault) {
      await prisma.customerAddress.updateMany({
        where: { tenantId, customerId, id: { not: addressId } },
        data:  { isDefault: false },
      });
    }

    return prisma.customerAddress.update({
      where: { id: addressId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.district !== undefined ? { district: data.district } : {}),
        ...(data.addressLine !== undefined ? { addressLine: data.addressLine } : {}),
        ...(data.postalCode !== undefined ? { postalCode: data.postalCode || null } : {}),
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
      },
    });
  }

  async deleteAddress(tenantId: string, customerId: string, addressId: string) {
    const existing = await prisma.customerAddress.findFirst({
      where: { id: addressId, tenantId, customerId },
    });
    if (!existing) throw new Error('Adres bulunamadı.');

    await prisma.customerAddress.delete({ where: { id: addressId } });

    if (existing.isDefault) {
      const next = await prisma.customerAddress.findFirst({
        where:   { tenantId, customerId },
        orderBy: { createdAt: 'desc' },
      });
      if (next) {
        await prisma.customerAddress.update({
          where: { id: next.id },
          data:  { isDefault: true },
        });
      }
    }
  }
}

export const storeAccountService = new StoreAccountService();
