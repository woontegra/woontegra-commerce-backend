import {
  IMarketplaceProvider, ProviderConfig,
  NormalizedProduct, NormalizedOrder, StockPriceItem,
  SendResult, UpdateResult, FetchOrdersOptions, ConnectionTestResult,
} from '../../core/interfaces/IMarketplaceProvider';

export class AmazonProvider implements IMarketplaceProvider {
  readonly name = 'Amazon';
  constructor(_config: ProviderConfig) {}

  async testConnection(): Promise<ConnectionTestResult>        { return { ok: false, message: 'Amazon entegrasyonu henüz aktif değil.' }; }
  async sendProducts(_: NormalizedProduct[]): Promise<SendResult>      { throw new Error('Amazon entegrasyonu henüz aktif değil.'); }
  async updateStockAndPrice(_: StockPriceItem[]): Promise<UpdateResult>{ throw new Error('Amazon entegrasyonu henüz aktif değil.'); }
  async fetchOrders(_?: FetchOrdersOptions): Promise<NormalizedOrder[]>{ throw new Error('Amazon entegrasyonu henüz aktif değil.'); }
}
