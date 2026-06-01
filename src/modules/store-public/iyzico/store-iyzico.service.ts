import Iyzipay from 'iyzipay';
import { OrderStatus, StorePaymentSessionStatus } from '@prisma/client';
import prisma from '../../../config/database';
import { buildStoreIyzicoClient, resolveIyzicoConfig } from './store-iyzico.config';
import type { StartIyzicoPaymentInput } from './store-iyzico.dto';
import type { StoreTenantPublic } from '../store-tenant.util';

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

function toKurus(amount: number): number {
  return Math.round(amount * 100);
}

function formatGsmNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('90') && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+9${digits}`;
  if (digits.length === 10) return `+90${digits}`;
  return digits ? `+${digits}` : '+905000000000';
}

function buildConversationId(tenantId: string, orderId: string): string {
  return `store_${tenantId.slice(0, 8)}_${orderId.slice(0, 8)}_${Date.now()}`;
}

function buildStoreIyzicoCallbackUrl(): string {
  const backendUrl = (process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');
  return `${backendUrl}/api/store/payments/iyzico/callback`;
}

function buildBasketItems(
  order: {
    orderNumber: string;
    items: Array<{ id: string; quantity: number; price: unknown; product: { name: string } }>;
    shippingPrice: unknown;
  },
  total: number,
): Array<{ id: string; name: string; category1: string; itemType: string; price: string }> {
  const items = order.items.map(i => ({
    id:        i.id,
    name:      i.product.name.slice(0, 200),
    category1: 'Ürün',
    itemType:  Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
    price:     (num(i.price) * i.quantity).toFixed(2),
  }));

  const shipping = num(order.shippingPrice);
  if (shipping > 0) {
    items.push({
      id:        `shipping-${order.orderNumber}`,
      name:      'Kargo',
      category1: 'Kargo',
      itemType:  Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
      price:     shipping.toFixed(2),
    });
  }

  const basketSum = items.reduce((s, i) => s + parseFloat(i.price), 0);
  if (Math.abs(basketSum - total) > 0.02) {
    return [{
      id:        order.orderNumber,
      name:      `Sipariş ${order.orderNumber}`,
      category1: 'Sipariş',
      itemType:  Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
      price:     total.toFixed(2),
    }];
  }

  return items;
}

export type StartIyzicoPaymentResult = {
  provider:            'IYZICO';
  token:               string;
  checkoutFormContent: string;
  orderNumber:         string;
  conversationId:      string;
};

export class StoreIyzicoService {
  async startPayment(
    tenant: StoreTenantPublic,
    input: StartIyzicoPaymentInput,
    userIp: string,
  ): Promise<StartIyzicoPaymentResult> {
    let config;
    try {
      config = await resolveIyzicoConfig(tenant.id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (/aktif değil/i.test(msg)) {
        throw new Error('iyzico ödeme yöntemi bu mağazada pasif.');
      }
      if (/eksik/i.test(msg)) {
        throw new Error('iyzico ayarları eksik. Yönetici panelinden API bilgilerini girin.');
      }
      throw e;
    }

    const order = await prisma.order.findFirst({
      where: {
        tenantId: tenant.id,
        ...(input.orderId ? { id: input.orderId } : { orderNumber: input.orderNumber }),
      },
      include: {
        customer: { select: { email: true, phone: true, firstName: true, lastName: true } },
        items: {
          include: { product: { select: { name: true } } },
        },
      },
    });

    if (!order) {
      throw new Error('Sipariş bulunamadı.');
    }

    if (order.tenantId !== tenant.id) {
      throw new Error('Sipariş bu mağazaya ait değil.');
    }

    if (order.status === OrderStatus.PAID) {
      throw new Error('Bu sipariş zaten ödenmiş. Ödeme başlatmaya uygun değil.');
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new Error('İptal edilmiş sipariş için ödeme başlatılamaz.');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new Error('Sipariş ödeme başlatmaya uygun değil.');
    }

    const total = num(order.totalAmount);
    if (total <= 0) {
      throw new Error('Sipariş tutarı geçersiz.');
    }

    const email = order.customer.email?.trim();
    const phone = order.customer.phone?.trim();
    if (!email) {
      throw new Error('Müşteri e-posta bilgisi eksik.');
    }
    if (!phone) {
      throw new Error('Müşteri telefon bilgisi eksik.');
    }

    const amountKurus = toKurus(total);
    const priceStr    = total.toFixed(2);
    const conversationId = buildConversationId(tenant.id, order.id);
    const buyerName = `${order.customer.firstName} ${order.customer.lastName}`.trim();
    const addressLine = (order.notes || 'Türkiye').slice(0, 200);
    const iyzipay = buildStoreIyzicoClient(config);

    const request = {
      locale:              Iyzipay.LOCALE.TR,
      conversationId,
      price:               priceStr,
      paidPrice:           priceStr,
      currency:            Iyzipay.CURRENCY.TRY,
      basketId:            order.id,
      paymentGroup:        Iyzipay.PAYMENT_GROUP.PRODUCT,
      callbackUrl:         buildStoreIyzicoCallbackUrl(),
      enabledInstallments: ['1', '2', '3', '6', '9'],
      buyer: {
        id:                  order.customerId,
        name:                order.customer.firstName || 'Müşteri',
        surname:             order.customer.lastName || '—',
        gsmNumber:           formatGsmNumber(phone),
        email,
        identityNumber:      '11111111111',
        registrationAddress: addressLine,
        ip:                  userIp || '127.0.0.1',
        city:                'Istanbul',
        country:             'Turkey',
        zipCode:             '34000',
      },
      shippingAddress: {
        contactName: buyerName || 'Müşteri',
        city:        'Istanbul',
        country:     'Turkey',
        address:     addressLine,
        zipCode:     '34000',
      },
      billingAddress: {
        contactName: buyerName || 'Müşteri',
        city:        'Istanbul',
        country:     'Turkey',
        address:     addressLine,
        zipCode:     '34000',
      },
      basketItems: buildBasketItems(order, total),
    };

    return new Promise((resolve, reject) => {
      iyzipay.checkoutFormInitialize.create(request, async (err: unknown, result: Record<string, unknown>) => {
        if (err || result.status !== 'success' || !result.token) {
          const errMsg =
            (err as Error)?.message ||
            String(result.errorMessage ?? '') ||
            'iyzico ödeme başlatılamadı.';
          reject(new Error(errMsg === 'iyzico ödeme başlatılamadı.' ? errMsg : `iyzico ödeme başlatılamadı: ${errMsg}`));
          return;
        }

        const token = String(result.token);

        try {
          await prisma.storePaymentSession.create({
            data: {
              tenantId:    tenant.id,
              orderId:     order.id,
              provider:    'IYZICO',
              merchantOid: token,
              amountKurus,
              status:      StorePaymentSessionStatus.INITIATED,
              providerPayload: {
                conversationId,
                initResponse: {
                  status:         result.status,
                  token,
                  paymentPageUrl: result.paymentPageUrl ?? null,
                  tokenExpireTime: result.tokenExpireTime ?? null,
                },
              },
            },
          });
        } catch {
          reject(new Error('iyzico ödeme oturumu kaydedilemedi.'));
          return;
        }

        resolve({
          provider:            'IYZICO',
          token,
          checkoutFormContent: String(result.checkoutFormContent ?? ''),
          orderNumber:         order.orderNumber,
          conversationId,
        });
      });
    });
  }
}

export const storeIyzicoService = new StoreIyzicoService();
