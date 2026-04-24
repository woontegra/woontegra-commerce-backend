import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

interface ShippingCalculationInput {
  tenantId: string;
  orderAmount: number;
  city: string;
  weight?: number;
}

interface ShippingCalculationResult {
  cost: number;
  ruleName: string;
  isFree: boolean;
  appliedRule: any;
}

interface WeightRange {
  min: number;
  max: number;
  cost: number;
}

export class ShippingRuleEngine {
  /**
   * Calculate shipping cost based on rules
   */
  async calculateShipping(input: ShippingCalculationInput): Promise<ShippingCalculationResult> {
    try {
      const { tenantId, orderAmount, city, weight = 0 } = input;

      // Get all active rules for tenant, sorted by priority (highest first)
      const rules = await prisma.shippingRule.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        orderBy: {
          priority: 'desc',
        },
      });

      if (rules.length === 0) {
        // No rules found, return default shipping
        return {
          cost: 0,
          ruleName: 'Default (Free)',
          isFree: true,
          appliedRule: null,
        };
      }

      // Find first matching rule
      for (const rule of rules) {
        if (this.matchesRule(rule, orderAmount, city)) {
          const cost = this.calculateCost(rule, orderAmount, weight);
          const isFree = this.isFreeShipping(rule, orderAmount);

          return {
            cost: isFree ? 0 : cost,
            ruleName: rule.name,
            isFree,
            appliedRule: rule,
          };
        }
      }

      // No matching rule, return default
      return {
        cost: 0,
        ruleName: 'Default (Free)',
        isFree: true,
        appliedRule: null,
      };
    } catch (error) {
      logger.error('[ShippingEngine] Error calculating shipping', {
        error: error instanceof Error ? error.message : 'Unknown error',
        input,
      });
      throw error;
    }
  }

  /**
   * Check if order matches rule conditions
   */
  private matchesRule(rule: any, orderAmount: number, city: string): boolean {
    // Check order amount range
    if (rule.minOrderAmount && orderAmount < Number(rule.minOrderAmount)) {
      return false;
    }

    if (rule.maxOrderAmount && orderAmount > Number(rule.maxOrderAmount)) {
      return false;
    }

    // Check city inclusion
    if (rule.cities && rule.cities.length > 0) {
      const normalizedCity = city.toLowerCase().trim();
      const normalizedCities = rule.cities.map((c: string) => c.toLowerCase().trim());
      
      if (!normalizedCities.includes(normalizedCity)) {
        return false;
      }
    }

    // Check city exclusion
    if (rule.excludedCities && rule.excludedCities.length > 0) {
      const normalizedCity = city.toLowerCase().trim();
      const normalizedExcluded = rule.excludedCities.map((c: string) => c.toLowerCase().trim());
      
      if (normalizedExcluded.includes(normalizedCity)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Calculate shipping cost based on rule type
   */
  private calculateCost(rule: any, orderAmount: number, weight: number): number {
    switch (rule.calculationType) {
      case 'fixed':
        return Number(rule.shippingCost);

      case 'percentage':
        if (rule.percentageRate) {
          return (orderAmount * Number(rule.percentageRate)) / 100;
        }
        return Number(rule.shippingCost);

      case 'weight_based':
        if (rule.weightRanges) {
          const ranges = rule.weightRanges as WeightRange[];
          const matchingRange = ranges.find(
            (range) => weight >= range.min && weight <= range.max
          );
          
          if (matchingRange) {
            return matchingRange.cost;
          }
        }
        return Number(rule.shippingCost);

      default:
        return Number(rule.shippingCost);
    }
  }

  /**
   * Check if shipping is free based on threshold
   */
  private isFreeShipping(rule: any, orderAmount: number): boolean {
    if (rule.freeShippingThreshold) {
      return orderAmount >= Number(rule.freeShippingThreshold);
    }
    return false;
  }

  /**
   * Get all applicable rules for preview
   */
  async getApplicableRules(
    tenantId: string,
    orderAmount: number,
    city: string
  ): Promise<any[]> {
    const rules = await prisma.shippingRule.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      orderBy: {
        priority: 'desc',
      },
    });

    return rules.filter((rule) => this.matchesRule(rule, orderAmount, city));
  }
}

export const shippingRuleEngine = new ShippingRuleEngine();
