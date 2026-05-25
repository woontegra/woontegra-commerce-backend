import crypto from 'crypto';
import axios from 'axios';
import { OrderStatus, StorePaymentSessionStatus } from '@prisma/client';
import prisma from '../../../config/database';
import { OrderService } from '../../orders/order.service';
import { storeEmailService } from '../store-email.service';
import { buildPaytrRedirectUrls, resolvePaytrConfig } from './store-paytr.config';
// resolvePaytrConfig is async (tenant settings + env fallback)
import {
  shouldSendPaytrPaymentFailedNotification,
  shouldSendPaytrPaymentReceivedNotification,
} from '../../email/templates/store-email.util';
import { buildPaytrIframeToken, verifyPaytrCallbackHash } from './store-paytr.crypto';
import type { StartPaytrPaymentInput } from './store-paytr.dto';
import type { StoreTenantPublic } from '../store-tenant.util';

const PAYTR_TOKEN_URL = 'https://www.paytr.com/odeme/api/get-token';

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

function formatBasketPrice(unitPrice: number): string {
  return unitPrice.toFixed(2);
}

function buildUserBasketBase64(
  items: Array<{ product: { name: string }; quantity: number; price: unknown }>,
): string {
  const basket = items.map(i => [
    i.product.name.slice(0, 200),
    formatBasketPrice(num(i.price)),
    i.quantity,
  ]);
  return Buffer.from(JSON.stringify(basket), 'utf8').toString('base64');
}

async function appendOrderNote(orderId: string, line: string): Promise<void> {
  const o = await prisma.order.findUnique({
    where:  { id: orderId },
    select: { notes: true },
  });
  const next = [o?.notes?.trim(), line].filter(Boolean).join('\n\n');
  await prisma.order.update({
    where: { id: orderId },
    data:  { notes: next || line },
  });
}

export class StorePaytrService {
  private readonly orderService = new OrderService();

  async startPayment(
    tenant: StoreTenantPublic,
    input: StartPaytrPaymentInput,
    userIp: string,
  ) {
    const config = await resolvePaytrConfig(tenant.id, tenant.slug);
    if (!config) {
      throw new Error('PayTR yapılandırması eksik. Yönetici PAYTR_* ortam değişkenlerini tanımlamalı.');
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

    if (order.status === OrderStatus.PAID) {
      throw new Error('Bu sipariş zaten ödenmiş.');
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new Error('İptal edilmiş sipariş için ödeme başlatılamaz.');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new Error('Yalnızca ödeme bekleyen (PENDING) siparişler için ödeme başlatılabilir.');
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
    const merchantOid = cryptoRandomOid();

    const session = await prisma.storePaymentSession.create({
      data: {
        tenantId:    tenant.id,
        orderId:     order.id,
        provider:    'PAYTR',
        merchantOid,
        amountKurus,
        status:      StorePaymentSessionStatus.INITIATED,
      },
    });

    const userBasket = buildUserBasketBase64(order.items);
    const paymentAmountStr = String(amountKurus);
    const userName = `${order.customer.firstName} ${order.customer.lastName}`.trim().slice(0, 60);
    const userAddress = (order.notes || 'Türkiye').slice(0, 400);
    const { okUrl, failUrl } = buildPaytrRedirectUrls(config, tenant.slug, order.orderNumber);

    const noInstallment  = '0';
    const maxInstallment = '0';
    const currency       = 'TL';
    const testMode       = config.testMode ? '1' : '0';

    const paytrToken = buildPaytrIframeToken({
      merchantId:     config.merchantId,
      merchantKey:    config.merchantKey,
      merchantSalt:   config.merchantSalt,
      userIp,
      merchantOid,
      email,
      paymentAmount:  paymentAmountStr,
      userBasket,
      noInstallment,
      maxInstallment,
      currency,
      testMode,
    });

    const form = new URLSearchParams({
      merchant_id:      config.merchantId,
      user_ip:          userIp,
      merchant_oid:     merchantOid,
      email,
      payment_amount:   paymentAmountStr,
      paytr_token:      paytrToken,
      user_basket:      userBasket,
      debug_on:         testMode,
      test_mode:        testMode,
      no_installment:   noInstallment,
      max_installment:  maxInstallment,
      user_name:        userName,
      user_address:     userAddress,
      user_phone:       phone,
      merchant_ok_url:  okUrl,
      merchant_fail_url: failUrl,
      timeout_limit:    '30',
      currency,
      lang:             'tr',
    });

    let paytrResponse: { status?: string; reason?: string; token?: string };
    try {
      const res = await axios.post(PAYTR_TOKEN_URL, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30_000,
      });
      paytrResponse = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    } catch (e: unknown) {
      await prisma.storePaymentSession.update({
        where: { id: session.id },
        data:  {
          status:          StorePaymentSessionStatus.FAILED,
          providerPayload: { error: String(e) },
        },
      });
      throw new Error('PayTR ödeme oturumu oluşturulamadı. Lütfen daha sonra tekrar deneyin.');
    }

    if (paytrResponse.status !== 'success' || !paytrResponse.token) {
      await prisma.storePaymentSession.update({
        where: { id: session.id },
        data:  {
          status:          StorePaymentSessionStatus.FAILED,
          providerPayload: paytrResponse as object,
        },
      });
      throw new Error(paytrResponse.reason || 'PayTR token alınamadı.');
    }

    await prisma.storePaymentSession.update({
      where: { id: session.id },
      data:  { providerPayload: { tokenRequest: { status: 'success' } } },
    });

    return {
      provider:  'PAYTR' as const,
      token:     paytrResponse.token,
      iframeUrl: `https://www.paytr.com/odeme/guvenli/${paytrResponse.token}`,
      orderNumber: order.orderNumber,
      merchantOid,
    };
  }

  /**
   * PayTR bildirim URL — hash doğrulaması + idempotent sipariş güncelleme.
   * Her zaman "OK" döner (PayTR tekrar denemesin); hata loglanır.
   */
  async handleCallback(body: Record<string, string | undefined>): Promise<'OK'> {
    const merchantOid  = String(body.merchant_oid ?? '');
    const status       = String(body.status ?? '');
    const totalAmount  = String(body.total_amount ?? '');
    const hash         = String(body.hash ?? '');

    if (!merchantOid || !status || !totalAmount || !hash) {
      return 'OK';
    }

    const session = await prisma.storePaymentSession.findUnique({
      where:   { merchantOid },
      include: {
        order: {
          select: {
            id: true,
            status: true,
            orderNumber: true,
            totalAmount: true,
            tenantId: true,
            paymentReceivedEmailSentAt: true,
            paymentFailedEmailSentAt: true,
            tenant: { select: { slug: true } },
          },
        },
      },
    });

    if (!session?.order) {
      return 'OK';
    }

    const config = await resolvePaytrConfig(session.tenantId, session.order.tenant.slug);
    if (!config) {
      return 'OK';
    }

    if (
      !verifyPaytrCallbackHash({
        merchantKey:  config.merchantKey,
        merchantSalt: config.merchantSalt,
        merchantOid,
        status,
        totalAmount,
        hash,
      })
    ) {
      return 'OK';
    }

    const callbackKurus = parseInt(totalAmount, 10);
    if (!Number.isFinite(callbackKurus) || callbackKurus !== session.amountKurus) {
      await appendOrderNote(
        session.orderId,
        `[PayTR] Tutar uyuşmazlığı: beklenen ${session.amountKurus}, gelen ${totalAmount}`,
      );
      return 'OK';
    }

    await prisma.storePaymentSession.update({
      where: { id: session.id },
      data:  { providerPayload: body as object },
    });

    const order = session.order;

    if (status === 'success') {
      if (order.status === OrderStatus.PAID) {
        if (session.status !== StorePaymentSessionStatus.SUCCESS) {
          await prisma.storePaymentSession.update({
            where: { id: session.id },
            data:  { status: StorePaymentSessionStatus.SUCCESS },
          });
        }
        return 'OK';
      }

      if (order.status === OrderStatus.PENDING) {
        await this.orderService.updateStatus(order.id, OrderStatus.PAID, session.tenantId, {
          notifyCustomer: false,
        });
        await prisma.order.update({
          where: { id: order.id },
          data: {
            paymentProvider: 'PAYTR',
            paymentStatus:   'PAID',
            paymentApprovedAt: new Date(),
          },
        });
        await appendOrderNote(
          session.orderId,
          `[PayTR] Ödeme başarılı — merchant_oid: ${merchantOid}, tutar: ${totalAmount} kuruş`,
        );
        if (shouldSendPaytrPaymentReceivedNotification(order)) {
          void storeEmailService.notifyOrderPaymentReceived(session.tenantId, order.id, {
            paymentProvider: 'PAYTR',
          });
        }
      }

      await prisma.storePaymentSession.update({
        where: { id: session.id },
        data:  { status: StorePaymentSessionStatus.SUCCESS },
      });
      return 'OK';
    }

    // failed
    if (session.status === StorePaymentSessionStatus.SUCCESS) {
      return 'OK';
    }

    const sendPaymentFailedEmail = shouldSendPaytrPaymentFailedNotification(
      session.status,
      order.status,
      order,
    );

    if (session.status !== StorePaymentSessionStatus.FAILED) {
      await prisma.storePaymentSession.update({
        where: { id: session.id },
        data:  { status: StorePaymentSessionStatus.FAILED },
      });
    }

    if (order.status === OrderStatus.PENDING) {
      await this.orderService.updateStatus(order.id, OrderStatus.CANCELLED, session.tenantId, {
        notifyCustomer: false,
      });
      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentProvider: 'PAYTR',
          paymentStatus:   'FAILED',
          paymentFailedAt: new Date(),
        },
      });
      if (sendPaymentFailedEmail) {
        void storeEmailService.notifyOrderPaymentFailed(session.tenantId, order.id, {
          paymentProvider: 'PAYTR',
        });
      }
      const reason = body.failed_reason_msg || body.failed_reason_code || 'bilinmiyor';
      await appendOrderNote(
        session.orderId,
        `[PayTR] Ödeme başarısız — ${reason}. Stok iade edildi (sipariş CANCELLED).`,
      );
    } else if (order.status !== OrderStatus.CANCELLED) {
      await appendOrderNote(
        session.orderId,
        `[PayTR] Ödeme başarısız bildirimi (sipariş durumu: ${order.status}).`,
      );
    }

    return 'OK';
  }
}

function cryptoRandomOid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export const storePaytrService = new StorePaytrService();
