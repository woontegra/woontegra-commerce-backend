import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

export interface CurrencyConversion {
  from: string;
  to: string;
  amount: number;
  convertedAmount: number;
  rate: number;
}

export class CurrencyService {
  /**
   * Fetch exchange rates from TCMB (Central Bank of Turkey)
   */
  static async fetchTCMBRates(): Promise<Record<string, number>> {
    try {
      const response = await axios.get('https://www.tcmb.gov.tr/kurlar/today.xml');
      const xml = response.data;
      
      // Parse XML (simple regex parsing)
      const rates: Record<string, number> = {};
      
      // USD
      const usdMatch = xml.match(/<Currency CrossOrder="\d+" Kod="USD"[^>]*>[\s\S]*?<ForexSelling>([\d.]+)<\/ForexSelling>/);
      if (usdMatch) rates.USD = parseFloat(usdMatch[1]);
      
      // EUR
      const eurMatch = xml.match(/<Currency CrossOrder="\d+" Kod="EUR"[^>]*>[\s\S]*?<ForexSelling>([\d.]+)<\/ForexSelling>/);
      if (eurMatch) rates.EUR = parseFloat(eurMatch[1]);
      
      // GBP
      const gbpMatch = xml.match(/<Currency CrossOrder="\d+" Kod="GBP"[^>]*>[\s\S]*?<ForexSelling>([\d.]+)<\/ForexSelling>/);
      if (gbpMatch) rates.GBP = parseFloat(gbpMatch[1]);
      
      return rates;
    } catch (error) {
      logger.error('[CurrencyService] Error fetching TCMB rates', { error });
      throw new Error('Failed to fetch TCMB rates');
    }
  }

  /**
   * Fetch exchange rates from ExchangeRate-API (fallback)
   */
  static async fetchExchangeRateAPI(): Promise<Record<string, number>> {
    try {
      const response = await axios.get('https://api.exchangerate-api.com/v4/latest/TRY');
      return response.data.rates;
    } catch (error) {
      logger.error('[CurrencyService] Error fetching ExchangeRate-API', { error });
      throw new Error('Failed to fetch exchange rates');
    }
  }

  /**
   * Update exchange rates in database
   */
  static async updateExchangeRates(tenantId?: string): Promise<void> {
    try {
      logger.info('[CurrencyService] Updating exchange rates...');

      // Try TCMB first, fallback to ExchangeRate-API
      let rates: Record<string, number>;
      let source: string;

      try {
        rates = await this.fetchTCMBRates();
        source = 'tcmb';
      } catch (error) {
        logger.warn('[CurrencyService] TCMB failed, using fallback API');
        rates = await this.fetchExchangeRateAPI();
        source = 'exchangerate-api';
      }

      // Update rates in database
      for (const [currency, rate] of Object.entries(rates)) {
        await prisma.exchangeRate.upsert({
          where: {
            baseCurrency_targetCurrency_tenantId: {
              baseCurrency: 'TRY',
              targetCurrency: currency,
              tenantId: tenantId || null,
            },
          },
          create: {
            baseCurrency: 'TRY',
            targetCurrency: currency,
            rate,
            source,
            lastUpdated: new Date(),
            tenantId: tenantId || null,
          },
          update: {
            rate,
            source,
            lastUpdated: new Date(),
          },
        });
      }

      logger.info('[CurrencyService] Exchange rates updated', { 
        count: Object.keys(rates).length,
        source,
      });
    } catch (error) {
      logger.error('[CurrencyService] Error updating exchange rates', { error });
      throw error;
    }
  }

  /**
   * Get exchange rate
   */
  static async getExchangeRate(
    from: string,
    to: string,
    tenantId?: string
  ): Promise<number> {
    // Same currency
    if (from === to) return 1;

    // Get rate from database
    const rate = await prisma.exchangeRate.findFirst({
      where: {
        baseCurrency: from,
        targetCurrency: to,
        tenantId: tenantId || null,
      },
    });

    if (rate) {
      return Number(rate.rate);
    }

    // Try reverse rate
    const reverseRate = await prisma.exchangeRate.findFirst({
      where: {
        baseCurrency: to,
        targetCurrency: from,
        tenantId: tenantId || null,
      },
    });

    if (reverseRate) {
      return 1 / Number(reverseRate.rate);
    }

    throw new Error(`Exchange rate not found: ${from} -> ${to}`);
  }

  /**
   * Convert currency
   */
  static async convert(
    amount: number,
    from: string,
    to: string,
    tenantId?: string
  ): Promise<CurrencyConversion> {
    const rate = await this.getExchangeRate(from, to, tenantId);
    const convertedAmount = amount * rate;

    return {
      from,
      to,
      amount,
      convertedAmount: Number(convertedAmount.toFixed(2)),
      rate,
    };
  }

  /**
   * Get all exchange rates
   */
  static async getAllRates(tenantId?: string) {
    return await prisma.exchangeRate.findMany({
      where: { tenantId: tenantId || null },
      orderBy: { targetCurrency: 'asc' },
    });
  }

  /**
   * Supported currencies
   */
  static readonly SUPPORTED_CURRENCIES = [
    { code: 'TRY', symbol: '₺', name: 'Turkish Lira' },
    { code: 'USD', symbol: '$', name: 'US Dollar' },
    { code: 'EUR', symbol: '€', name: 'Euro' },
    { code: 'GBP', symbol: '£', name: 'British Pound' },
  ];

  static readonly BASE_CURRENCY = 'TRY';
}

export const currencyService = CurrencyService;
