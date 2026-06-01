import type { StoreTenantPublic } from '../store-tenant.util';

export type StartIyzicoPaymentInput = {
  orderId?:     string;
  orderNumber?: string;
};

export class StoreIyzicoService {
  async startPayment(
    tenant: StoreTenantPublic,
    input: StartIyzicoPaymentInput,
    userIp: string,
  ): Promise<never> {
    void tenant;
    void input;
    void userIp;
    throw new Error('Iyzico payment start is not implemented yet');
  }
}

export const storeIyzicoService = new StoreIyzicoService();
