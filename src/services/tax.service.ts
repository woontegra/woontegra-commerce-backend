import { Decimal } from '@prisma/client/runtime/library';

export interface TaxCalculationItem {
  price: number;
  quantity: number;
  taxRate: number; // Percentage (e.g., 20 for 20%)
}

export interface TaxCalculationResult {
  subtotal: number;
  taxAmount: number;
  total: number;
  itemsWithTax: Array<{
    price: number;
    quantity: number;
    taxRate: number;
    itemSubtotal: number;
    itemTax: number;
    itemTotal: number;
  }>;
}

export class TaxService {
  /**
   * Calculate tax for multiple items
   */
  static calculateTax(items: TaxCalculationItem[]): TaxCalculationResult {
    let subtotal = 0;
    let totalTax = 0;
    const itemsWithTax = [];

    for (const item of items) {
      const itemSubtotal = item.price * item.quantity;
      const itemTax = (itemSubtotal * item.taxRate) / 100;
      const itemTotal = itemSubtotal + itemTax;

      subtotal += itemSubtotal;
      totalTax += itemTax;

      itemsWithTax.push({
        price: item.price,
        quantity: item.quantity,
        taxRate: item.taxRate,
        itemSubtotal: Number(itemSubtotal.toFixed(2)),
        itemTax: Number(itemTax.toFixed(2)),
        itemTotal: Number(itemTotal.toFixed(2)),
      });
    }

    return {
      subtotal: Number(subtotal.toFixed(2)),
      taxAmount: Number(totalTax.toFixed(2)),
      total: Number((subtotal + totalTax).toFixed(2)),
      itemsWithTax,
    };
  }

  /**
   * Calculate tax for a single item
   */
  static calculateItemTax(price: number, quantity: number, taxRate: number) {
    const subtotal = price * quantity;
    const tax = (subtotal * taxRate) / 100;
    const total = subtotal + tax;

    return {
      subtotal: Number(subtotal.toFixed(2)),
      tax: Number(tax.toFixed(2)),
      total: Number(total.toFixed(2)),
    };
  }

  /**
   * Calculate price without tax (reverse calculation)
   */
  static calculatePriceWithoutTax(priceWithTax: number, taxRate: number): number {
    const priceWithoutTax = priceWithTax / (1 + taxRate / 100);
    return Number(priceWithoutTax.toFixed(2));
  }

  /**
   * Calculate tax amount from price with tax
   */
  static extractTaxAmount(priceWithTax: number, taxRate: number): number {
    const priceWithoutTax = this.calculatePriceWithoutTax(priceWithTax, taxRate);
    return Number((priceWithTax - priceWithoutTax).toFixed(2));
  }

  /**
   * Get tax breakdown by rate
   */
  static getTaxBreakdown(items: TaxCalculationItem[]): Record<number, { subtotal: number; tax: number }> {
    const breakdown: Record<number, { subtotal: number; tax: number }> = {};

    for (const item of items) {
      const itemSubtotal = item.price * item.quantity;
      const itemTax = (itemSubtotal * item.taxRate) / 100;

      if (!breakdown[item.taxRate]) {
        breakdown[item.taxRate] = { subtotal: 0, tax: 0 };
      }

      breakdown[item.taxRate].subtotal += itemSubtotal;
      breakdown[item.taxRate].tax += itemTax;
    }

    // Round values
    for (const rate in breakdown) {
      breakdown[rate].subtotal = Number(breakdown[rate].subtotal.toFixed(2));
      breakdown[rate].tax = Number(breakdown[rate].tax.toFixed(2));
    }

    return breakdown;
  }

  /**
   * Common Turkish tax rates
   */
  static readonly TAX_RATES = {
    STANDARD: 20,    // Standart KDV
    REDUCED_1: 10,   // İndirimli KDV 1
    REDUCED_2: 1,    // İndirimli KDV 2
    EXEMPT: 0,       // Muaf
  };
}

export const taxService = TaxService;
