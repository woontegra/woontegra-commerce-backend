import { OrderStatus, type PaymentProviderType } from '@prisma/client';
import { initialOrderPaymentStatus } from '../orders/order-payment.util';
import prisma from '../../config/database';
import { logger } from '../../config/logger';
import { OrderService, StockError, type CreateOrderItemDto } from '../orders/order.service';
import { CampaignService, type CartItem as CampaignCartItem } from '../campaigns/campaign.service';
import { CouponService, type CouponValidationResult } from '../coupons/coupon.service';
import { storePaymentProviderService } from '../payments/store-payment-provider.service';
import { storeShippingCalculationService } from '../shipping/store-shipping-calculation.service';
import { storeEmailService } from './store-email.service';
import type { CreateStoreOrderInput, StoreAddressBlock } from './store-order.dto';
import {
  consentFieldsForCreate,
  consentFieldsForUpdate,
} from '../customers/customer-consent.util';

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v && typeof (v as { toNumber: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function effectiveUnitPrice(sale: number, discount: number | null): number {
  if (discount != null && discount > 0 && discount < sale) return discount;
  return sale;
}

function formatAddressBlock(a: StoreAddressBlock): string {
  const zip = a.postalCode?.trim() ? ` ${a.postalCode}` : '';
  return `${a.fullName} · ${a.phone}\n${a.addressLine}\n${a.district} / ${a.city}${zip}`;
}

export const STORE_CUSTOMER_CHECKOUT_BLOCKED_MESSAGE =
  'Bu müşteri hesabı için sipariş oluşturma geçici olarak kısıtlanmıştır. Lütfen mağaza ile iletişime geçin.';

function assertCustomerCanCheckout(
  tenantId: string,
  customer: { id: string; email: string; isBlocked: boolean; blockedReason?: string | null },
): void {
  if (!customer.isBlocked) return;
  logger.warn({
    message: 'Blocked customer attempted storefront checkout',
    tenantId,
    customerId: customer.id,
    email:      customer.email,
    ...(customer.blockedReason?.trim()
      ? { blockedReason: customer.blockedReason.trim() }
      : {}),
  });
  throw new Error(STORE_CUSTOMER_CHECKOUT_BLOCKED_MESSAGE);
}

export class StoreOrderService {
  private readonly orderService = new OrderService();

  /**
   * Sepet satırlarından kampanya sonrası tutar üzerinde kupon doğrulama (vitrin önizleme).
   */
  async validateCoupon(
    tenantId: string,
    code: string,
    items: CreateStoreOrderInput['items'],
    customerId?: string,
  ): Promise<CouponValidationResult> {
    const orderItems = await this.buildPricedOrderItems(tenantId, items);
    const subtotal = orderItems.reduce((s, i) => s + i.price * i.quantity, 0);

    const productCategoryMap = new Map<string, string | null>();
    const products = await prisma.product.findMany({
      where:  { id: { in: [...new Set(orderItems.map(i => i.productId))] }, tenantId },
      select: { id: true, categoryId: true },
    });
    for (const p of products) {
      productCategoryMap.set(p.id, p.categoryId ?? null);
    }

    const cartItems: CampaignCartItem[] = orderItems.map(item => ({
      productId:  item.productId,
      variantId:  item.variantId,
      quantity:   item.quantity,
      price:      item.price,
      categoryId: productCategoryMap.get(item.productId) ?? undefined,
    }));

    const campaignResult = await new CampaignService().applyToCart(cartItems, tenantId);
    const afterCampaignTotal = Math.max(0, subtotal - (campaignResult.savings ?? 0));

    return new CouponService().validate(code, afterCampaignTotal, tenantId, customerId);
  }

  private async buildPricedOrderItems(
    tenantId: string,
    items: CreateStoreOrderInput['items'],
  ): Promise<CreateOrderItemDto[]> {
    const orderItems: CreateOrderItemDto[] = [];

    for (const line of items) {
      const product = await prisma.product.findFirst({
        where: {
          id:       line.productId,
          tenantId,
          isActive: true,
          status:   'active',
        },
        include: { pricing: true },
      });

      if (!product) {
        throw new Error(`Ürün bulunamadı veya satışa kapalı: ${line.productId}`);
      }

      const salePrice     = num(product.pricing?.salePrice ?? product.price);
      const discountPrice = product.pricing?.discountPrice != null
        ? num(product.pricing.discountPrice)
        : null;
      let unitPrice = effectiveUnitPrice(salePrice, discountPrice);
      let variantId: string | undefined;

      if (line.variantId) {
        const variant = await prisma.productVariant.findFirst({
          where: {
            id:        line.variantId,
            productId: product.id,
            isActive:  true,
          },
        });
        if (!variant) {
          throw new Error(`Varyant bulunamadı: ${line.variantId}`);
        }
        variantId = variant.id;
        if (variant.price != null) {
          unitPrice = num(variant.price);
        } else if (variant.discountPrice != null) {
          unitPrice = num(variant.discountPrice);
        }
      }

      if (unitPrice <= 0) {
        throw new Error(`"${product.name}" için geçerli fiyat tanımlı değil.`);
      }

      orderItems.push({
        productId: product.id,
        variantId,
        quantity:  line.quantity,
        price:     unitPrice,
      });
    }

    return orderItems;
  }

  /**
   * Mağaza vitrini siparişi — fiyatlar sunucuda hesaplanır, stok OrderService.create ile düşer.
   */
  async create(
    tenantId: string,
    input: CreateStoreOrderInput,
    opts?: { authenticatedCustomerId?: string },
  ) {
    const { items, customer, billingAddress, notes, paymentProvider, consents } = input;
    const deliveryAddress: StoreAddressBlock = input.shippingAddress;
    const isGuest = !opts?.authenticatedCustomerId;

    if (isGuest && !consents?.kvkkConsent) {
      throw new Error('KVKK aydınlatma metnini kabul etmelisiniz.');
    }

    const orderItems = await this.buildPricedOrderItems(tenantId, items);

    for (const line of items) {
      const product = await prisma.product.findFirst({
        where: { id: line.productId, tenantId },
        include: { stock: { select: { quantity: true } } },
      });
      if (!product) continue;

      if (line.variantId) {
        const variant = await prisma.productVariant.findFirst({
          where: { id: line.variantId, productId: product.id, isActive: true },
        });
        if (variant) {
          const available = Number(variant.stockQuantity);
          if (available < line.quantity) {
            throw new StockError(
              `Yetersiz stok: "${product.name}" (${variant.name}) — mevcut: ${available}, istenen: ${line.quantity}`,
              { productId: product.id, variantId: variant.id, available, requested: line.quantity },
            );
          }
        }
      } else {
        const stock = product.stock;
        if (stock && Number(stock.quantity) < line.quantity) {
          throw new StockError(
            `Yetersiz stok: "${product.name}" — mevcut: ${Number(stock.quantity)}, istenen: ${line.quantity}`,
            { productId: product.id, available: Number(stock.quantity), requested: line.quantity },
          );
        }
      }
    }

    const email = customer.email.trim().toLowerCase();
    const shipAddrText = formatAddressBlock(deliveryAddress);

    let customerRow = null as Awaited<ReturnType<typeof prisma.customer.findFirst>>;

    if (opts?.authenticatedCustomerId) {
      customerRow = await prisma.customer.findFirst({
        where: { id: opts.authenticatedCustomerId, tenantId },
      });
      if (!customerRow) {
        throw new Error('Oturum geçersiz. Lütfen tekrar giriş yapın.');
      }
      if (customerRow.email.toLowerCase() !== email) {
        throw new Error('Sipariş e-postası hesabınızla eşleşmiyor.');
      }
      customerRow = await prisma.customer.update({
        where: { id: customerRow.id },
        data: {
          firstName: customer.firstName.trim(),
          lastName:  customer.lastName.trim(),
          phone:     customer.phone.trim(),
          address:   shipAddrText,
          city:      deliveryAddress.city.trim(),
          zipCode:   deliveryAddress.postalCode?.trim() || null,
          ...((consents && customerRow)
            ? consentFieldsForUpdate(customerRow, consents)
            : {}),
        },
      });
    } else {
      customerRow = await prisma.customer.findFirst({
        where: { email, tenantId },
      });

      if (!customerRow) {
        customerRow = await prisma.customer.create({
          data: {
            email,
            firstName: customer.firstName.trim(),
            lastName:  customer.lastName.trim(),
            phone:     customer.phone.trim(),
            address:   shipAddrText,
            city:      deliveryAddress.city.trim(),
            zipCode:   deliveryAddress.postalCode?.trim() || null,
            country:   'TR',
            tenantId,
            ...consentFieldsForCreate(consents!),
          },
        });
      } else {
        customerRow = await prisma.customer.update({
          where: { id: customerRow.id },
          data: {
            firstName: customer.firstName.trim(),
            lastName:  customer.lastName.trim(),
            phone:     customer.phone.trim(),
            address:   shipAddrText,
            city:      deliveryAddress.city.trim(),
            zipCode:   deliveryAddress.postalCode?.trim() || null,
            ...((consents && customerRow)
            ? consentFieldsForUpdate(customerRow, consents)
            : {}),
          },
        });
      }
    }

    assertCustomerCanCheckout(tenantId, customerRow);

    if (paymentProvider) {
      const methods = await storePaymentProviderService.listActiveMethodsForStorefront(tenantId);
      const allowed = methods.some(m => m.provider === paymentProvider);
      if (!allowed) {
        throw new Error('Seçilen ödeme yöntemi bu mağazada aktif değil.');
      }
    }

    const shippingCalc = await storeShippingCalculationService.calculate(
      tenantId,
      items.map(i => ({
        productId: i.productId,
        variantId: i.variantId ?? null,
        quantity:  i.quantity,
      })),
      paymentProvider,
    );

    const noteParts: string[] = [];
    if (notes?.trim()) noteParts.push(notes.trim());
    if (paymentProvider) {
      noteParts.push(`[Ödeme yöntemi: ${paymentProvider}]`);
    }
    noteParts.push(
      `[Kargo: ${shippingCalc.shipping.displayName} — ${shippingCalc.shipping.shippingTotal.toFixed(2)} ₺` +
        (shippingCalc.shipping.freeShippingApplied ? ' (ücretsiz kargo)' : '') +
        ']',
    );
    if (shippingCalc.fees.cashOnDeliveryFee > 0) {
      noteParts.push(`[Kapıda ödeme ek ücreti: ${shippingCalc.fees.cashOnDeliveryFee.toFixed(2)} ₺]`);
    }
    noteParts.push(`[Vitrin siparişi — ödeme bekleniyor]`);
    noteParts.push(`Teslimat:\n${shipAddrText}`);

    if (!billingAddress.sameAsShipping) {
      const billCity = billingAddress.city?.trim() ?? '';
      const billLine = billingAddress.addressLine?.trim() ?? '';
      if (billCity && billLine) {
        noteParts.push(
          `Fatura:\n${formatAddressBlock({
            fullName:    billingAddress.fullName?.trim() || `${customer.firstName} ${customer.lastName}`.trim(),
            phone:       billingAddress.phone?.trim() || customer.phone.trim(),
            city:        billCity,
            district:    billingAddress.district?.trim() || '—',
            addressLine: billLine,
            postalCode:  billingAddress.postalCode?.trim() || '',
          })}`,
        );
        if (billingAddress.type === 'corporate' && billingAddress.companyName) {
          noteParts.push(
            `Kurumsal: ${billingAddress.companyName}` +
              (billingAddress.taxNumber ? ` · VKN: ${billingAddress.taxNumber}` : '') +
              (billingAddress.taxOffice ? ` · VD: ${billingAddress.taxOffice}` : ''),
          );
        }
      }
    }

    const storefrontProvider = paymentProvider as PaymentProviderType | undefined;

    const result = await this.orderService.create(
      {
        customerId:   customerRow.id,
        items:        orderItems,
        notes:        noteParts.join('\n\n'),
        currency:     'TRY',
        shippingPrice: shippingCalc.shipping.shippingTotal,
        extraFees:     shippingCalc.fees.cashOnDeliveryFee,
        paymentProvider: storefrontProvider,
        paymentStatus: storefrontProvider
          ? initialOrderPaymentStatus(storefrontProvider)
          : undefined,
        ...(input.couponCode?.trim() ? { couponCode: input.couponCode.trim() } : {}),
      },
      tenantId,
    );

    let order = result.order;

    const subtotal = shippingCalc.subtotal;
    const shippingTotal = shippingCalc.shipping.shippingTotal;
    const cashOnDeliveryFee = shippingCalc.fees.cashOnDeliveryFee;

    if (paymentProvider === 'CASH_ON_DELIVERY') {
      order = await this.orderService.updateStatus(
        order.id,
        OrderStatus.PROCESSING,
        tenantId,
        { notifyCustomer: false },
      );
      await prisma.order.update({
        where: { id: order.id },
        data: {
          notes: `${order.notes ?? ''}\n\n[Kapıda ödeme — sipariş hazırlanıyor]`.trim(),
        },
      });
      void storeEmailService.notifyCashOnDeliveryOrderCreated(tenantId, order.id, {
        itemsSubtotal:     subtotal,
        shippingTotal,
        cashOnDeliveryFee,
      });
    } else if (paymentProvider === 'BANK_TRANSFER') {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          notes: `${order.notes ?? ''}\n\n[Havale/EFT — ödeme bekleniyor]`.trim(),
        },
      });
      void storeEmailService.notifyBankTransferPaymentPending(tenantId, order.id);
    }

    if (paymentProvider !== 'CASH_ON_DELIVERY') {
      void storeEmailService.notifyOrderCreated(tenantId, order.id, {
        paymentProvider: paymentProvider ?? null,
        itemsSubtotal:     subtotal,
        shippingTotal,
      });
    }

    return {
      order,
      paymentProvider: paymentProvider ?? null,
      summary: {
        subtotal,
        shippingTotal,
        cashOnDeliveryFee,
        discountTotal: Number(order.discountAmount) + Number(order.campaignDiscount),
        grandTotal:    Number(order.totalAmount),
        currency:      order.currency,
      },
      appliedCampaigns: result.appliedCampaigns,
    };
  }
}

export const storeOrderService = new StoreOrderService();
