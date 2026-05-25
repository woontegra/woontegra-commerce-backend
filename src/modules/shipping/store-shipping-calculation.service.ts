import { PaymentProviderType } from '@prisma/client';
import prisma from '../../config/database';
import { tenantPaymentSettingsService } from '../payments/tenant-payment-settings.service';
import type { CashOnDeliveryPublicConfig } from '../payments/payment-provider.types';
import { tenantShippingSettingsService } from './tenant-shipping-settings.service';
import type {
  StoreShippingCalculateItem,
  StoreShippingCalculateResult,
} from './tenant-shipping-settings.types';

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

export class StoreShippingCalculationService {
  async resolveCartSubtotal(
    tenantId: string,
    items: StoreShippingCalculateItem[],
  ): Promise<number> {
    if (!items.length) return 0;

    let subtotal = 0;
    for (const line of items) {
      const product = await prisma.product.findFirst({
        where: {
          id:       line.productId,
          tenantId,
          isActive: true,
          status:   'active',
        },
        include: {
          pricing: true,
        },
      });
      if (!product) {
        throw new Error(`Ürün bulunamadı veya satışa kapalı: ${line.productId}`);
      }

      const salePrice     = num(product.pricing?.salePrice ?? product.price);
      const discountPrice = product.pricing?.discountPrice != null
        ? num(product.pricing.discountPrice)
        : null;
      let unitPrice = effectiveUnitPrice(salePrice, discountPrice);

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
        if (variant.price != null) {
          unitPrice = num(variant.price);
        } else if (variant.discountPrice != null) {
          unitPrice = num(variant.discountPrice);
        }
      }

      if (unitPrice <= 0) {
        throw new Error(`"${product.name}" için geçerli fiyat tanımlı değil.`);
      }

      subtotal += unitPrice * line.quantity;
    }
    return Math.round(subtotal * 100) / 100;
  }

  async resolveCashOnDeliveryFee(
    tenantId: string,
    paymentProvider?: PaymentProviderType | string,
  ): Promise<number> {
    if (paymentProvider !== 'CASH_ON_DELIVERY') return 0;
    const row = await tenantPaymentSettingsService.getActiveRow(tenantId, 'CASH_ON_DELIVERY');
    if (!row) return 0;
    const pub = (row.publicConfigJson ?? {}) as CashOnDeliveryPublicConfig;
    const fee = pub.extraFee != null ? num(pub.extraFee) : 0;
    return fee > 0 ? fee : 0;
  }

  async calculate(
    tenantId: string,
    items: StoreShippingCalculateItem[],
    paymentProvider?: PaymentProviderType | string,
  ): Promise<StoreShippingCalculateResult> {
    const settings = await tenantShippingSettingsService.getForStorefront(tenantId);
    if (!settings.isActive) {
      throw new Error('Bu mağazada kargo hizmeti şu an aktif değil.');
    }

    const subtotal = await this.resolveCartSubtotal(tenantId, items);
    const threshold = settings.freeShippingThreshold;
    const freeShippingApplied =
      threshold != null && threshold > 0 && subtotal >= threshold;
    const shippingTotal = freeShippingApplied ? 0 : settings.standardShippingCost;
    const cashOnDeliveryFee = await this.resolveCashOnDeliveryFee(tenantId, paymentProvider);
    const grandTotal = Math.round((subtotal + shippingTotal + cashOnDeliveryFee) * 100) / 100;

    return {
      success: true,
      subtotal,
      shipping: {
        method:                'STANDARD',
        displayName:           settings.displayName,
        shippingTotal,
        freeShippingApplied,
        freeShippingThreshold: threshold,
      },
      fees: { cashOnDeliveryFee },
      grandTotal,
    };
  }
}

export const storeShippingCalculationService = new StoreShippingCalculationService();
