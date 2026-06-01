import { PaymentProviderType } from '@prisma/client';

export { PaymentProviderType };

export const PAYMENT_PROVIDER_TYPES = [
  'PAYTR',
  'IYZICO',
  'BANK_POS',
  'BANK_TRANSFER',
  'CASH_ON_DELIVERY',
] as const satisfies readonly PaymentProviderType[];

/** Vitrinde listelenebilir (canlı entegrasyonu olan) sağlayıcılar */
export const STOREFRONT_ONLINE_PROVIDERS: PaymentProviderType[] = ['PAYTR', 'IYZICO'];

export const STOREFRONT_MANUAL_PROVIDERS: PaymentProviderType[] = [
  'BANK_TRANSFER',
  'CASH_ON_DELIVERY',
];

export type PaytrCredentials = {
  merchantId:   string;
  merchantKey:  string;
  merchantSalt: string;
};

export type IyzicoCredentials = {
  apiKey:    string;
  secretKey: string;
  baseUrl?:  string;
};

export type BankTransferPublicConfig = {
  bankName?:      string;
  accountHolder?: string;
  iban?:          string;
  description?:   string;
};

export type BankTransferCredentials = BankTransferPublicConfig;

export type CashOnDeliveryPublicConfig = {
  extraFee?:    number;
  description?: string;
};

export type BankPosCredentials = {
  bankName?:    string;
  clientId?:    string;
  storeKey?:    string;
  apiUser?:     string;
  apiPassword?: string;
  endpoint?:    string;
};

export type PublicBankAccount = {
  bankName:      string;
  accountHolder: string;
  ibanMasked:    string;
  description?:  string;
};

export type PublicPaymentMethod =
  | {
      provider:    'PAYTR';
      displayName: string;
      isActive:    true;
      isTestMode:  boolean;
    }
  | {
      provider:    'IYZICO';
      displayName: string;
      description: string;
      isActive:    true;
      isTestMode:  boolean;
    }
  | {
      provider:    'BANK_TRANSFER';
      displayName: string;
      isActive:    true;
      bankAccounts: PublicBankAccount[];
    }
  | {
      provider:     'CASH_ON_DELIVERY';
      displayName:  string;
      isActive:     true;
      extraFee?:    number;
      description?: string;
    };

export const DEFAULT_DISPLAY_NAMES: Record<PaymentProviderType, string> = {
  PAYTR:             'Kredi Kartı / Banka Kartı',
  IYZICO:            'iyzico',
  BANK_POS:          'Banka POS',
  BANK_TRANSFER:     'Havale / EFT',
  CASH_ON_DELIVERY:  'Kapıda Ödeme',
};
