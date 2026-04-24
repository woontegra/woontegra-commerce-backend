/**
 * N11Provider — Placeholder
 *
 * N11 entegrasyonu hazır olduğunda bu provider doldurulacak.
 * IMarketplaceProvider implement edildiği için sistem otomatik tanır.
 */

import {
  IMarketplaceProvider,
  ProviderConfig,
  NormalizedProduct,
  NormalizedOrder,
  StockPriceItem,
  SendResult,
  UpdateResult,
  FetchOrdersOptions,
  ConnectionTestResult,
} from '../../core/interfaces/IMarketplaceProvider';

export class N11Provider implements IMarketplaceProvider {
  readonly name = 'N11';

  constructor(_config: ProviderConfig) {}

  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: false, message: 'N11 entegrasyonu henüz aktif değil.' };
  }

  async sendProducts(_products: NormalizedProduct[]): Promise<SendResult> {
    throw new Error('N11 entegrasyonu henüz aktif değil.');
  }

  async updateStockAndPrice(_items: StockPriceItem[]): Promise<UpdateResult> {
    throw new Error('N11 entegrasyonu henüz aktif değil.');
  }

  async fetchOrders(_opts?: FetchOrdersOptions): Promise<NormalizedOrder[]> {
    throw new Error('N11 entegrasyonu henüz aktif değil.');
  }
}
