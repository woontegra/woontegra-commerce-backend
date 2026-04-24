import {
  IMarketplaceProvider, ProviderConfig,
  NormalizedProduct, NormalizedOrder, StockPriceItem,
  SendResult, UpdateResult, FetchOrdersOptions, ConnectionTestResult,
} from '../../core/interfaces/IMarketplaceProvider';

export class EtsyProvider implements IMarketplaceProvider {
  readonly name = 'Etsy';
  constructor(_config: ProviderConfig) {}

  async testConnection(): Promise<ConnectionTestResult>        { return { ok: false, message: 'Etsy entegrasyonu henüz aktif değil.' }; }
  async sendProducts(_: NormalizedProduct[]): Promise<SendResult>      { throw new Error('Etsy entegrasyonu henüz aktif değil.'); }
  async updateStockAndPrice(_: StockPriceItem[]): Promise<UpdateResult>{ throw new Error('Etsy entegrasyonu henüz aktif değil.'); }
  async fetchOrders(_?: FetchOrdersOptions): Promise<NormalizedOrder[]>{ throw new Error('Etsy entegrasyonu henüz aktif değil.'); }
}
