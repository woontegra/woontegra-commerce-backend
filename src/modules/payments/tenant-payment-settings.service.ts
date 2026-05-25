import { PaymentProviderType, Prisma } from '@prisma/client';
import prisma from '../../config/database';
import {
  decryptCredential,
  encryptCredential,
  isCredentialEncrypted,
} from '../../common/crypto/marketplace-credential.crypto';
import {
  DEFAULT_DISPLAY_NAMES,
  PAYMENT_PROVIDER_TYPES,
  type BankPosCredentials,
  type BankTransferCredentials,
  type BankTransferPublicConfig,
  type CashOnDeliveryPublicConfig,
  type IyzicoCredentials,
  type PaytrCredentials,
} from './payment-provider.types';

const SECRET_PLACEHOLDER = '***';

function maskIban(iban: string | undefined): string {
  if (!iban?.trim()) return '';
  const clean = iban.replace(/\s/g, '').toUpperCase();
  if (clean.length <= 8) return '****';
  return `${clean.slice(0, 4)}****${clean.slice(-4)}`;
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function encryptJson(obj: Record<string, unknown>): string {
  return encryptCredential(JSON.stringify(obj));
}

function decryptJson<T extends Record<string, unknown>>(stored: string | null | undefined): T | null {
  if (!stored) return null;
  try {
    const plain = isCredentialEncrypted(stored) ? decryptCredential(stored) : stored;
    return JSON.parse(plain) as T;
  } catch {
    return null;
  }
}

export type AdminPaymentSettingView = {
  provider:     PaymentProviderType;
  isActive:     boolean;
  isTestMode:   boolean;
  displayName:  string | null;
  publicConfig: Record<string, unknown> | null;
  credentials:  Record<string, string | boolean | number | null>;
  hasCredentials: boolean;
};

export class TenantPaymentSettingsService {
  async listForAdmin(tenantId: string): Promise<AdminPaymentSettingView[]> {
    const rows = await prisma.tenantPaymentSetting.findMany({
      where: { tenantId },
    });
    const byProvider = new Map(rows.map(r => [r.provider, r]));

    return PAYMENT_PROVIDER_TYPES.map(provider => {
      const row = byProvider.get(provider);
      if (!row) {
        return this.emptyAdminView(provider);
      }
      return this.toAdminView(row);
    });
  }

  async getForAdmin(tenantId: string, provider: PaymentProviderType): Promise<AdminPaymentSettingView> {
    const row = await prisma.tenantPaymentSetting.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    });
    return row ? this.toAdminView(row) : this.emptyAdminView(provider);
  }

  async upsert(
    tenantId: string,
    provider: PaymentProviderType,
    body: Record<string, unknown>,
  ): Promise<AdminPaymentSettingView> {
    const existing = await prisma.tenantPaymentSetting.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    });

    const existingCreds = decryptJson<Record<string, unknown>>(existing?.credentialsEncrypted ?? null) ?? {};
    const { credentials, publicConfig } = this.buildPayload(provider, body, existingCreds);

    const hasCredentialValues = Object.values(credentials).some(
      v => v != null && v !== '' && v !== false,
    );
    let credentialsEncrypted: string | null = existing?.credentialsEncrypted ?? null;
    if (hasCredentialValues) {
      credentialsEncrypted = encryptJson(credentials);
    }

    const row = await prisma.tenantPaymentSetting.upsert({
      where:  { tenantId_provider: { tenantId, provider } },
      create: {
        tenantId,
        provider,
        isActive:     Boolean(body.isActive ?? false),
        isTestMode:   Boolean(body.isTestMode ?? true),
        displayName:  typeof body.displayName === 'string' ? body.displayName.trim() || null : null,
        credentialsEncrypted: hasCredentialValues ? credentialsEncrypted : null,
        publicConfigJson: (publicConfig ?? null) as Prisma.InputJsonValue,
      },
      update: {
        isActive:     body.isActive !== undefined ? Boolean(body.isActive) : undefined,
        isTestMode:   body.isTestMode !== undefined ? Boolean(body.isTestMode) : undefined,
        displayName:  typeof body.displayName === 'string' ? body.displayName.trim() || null : undefined,
        ...(hasCredentialValues ? { credentialsEncrypted } : {}),
        ...(publicConfig !== undefined ? { publicConfigJson: publicConfig as Prisma.InputJsonValue } : {}),
      },
    });

    return this.toAdminView(row);
  }

  /** Backend-only — gizli alanlar. */
  async getDecryptedCredentials<T extends Record<string, unknown>>(
    tenantId: string,
    provider: PaymentProviderType,
  ): Promise<T | null> {
    const row = await prisma.tenantPaymentSetting.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    });
    if (!row?.isActive || !row.credentialsEncrypted) return null;
    return decryptJson<T>(row.credentialsEncrypted);
  }

  async getActiveRow(tenantId: string, provider: PaymentProviderType) {
    return prisma.tenantPaymentSetting.findFirst({
      where: { tenantId, provider, isActive: true },
    });
  }

  /**
   * Aktif Havale/EFT ayarı — vitrin ödeme maili için tam IBAN (tenant scope).
   */
  async getActiveBankTransferDetails(tenantId: string): Promise<{
    bankName:      string;
    accountHolder: string;
    iban:          string;
    description:   string;
  } | null> {
    const row = await this.getActiveRow(tenantId, 'BANK_TRANSFER');
    if (!row) return null;

    const pub = (row.publicConfigJson ?? {}) as BankTransferPublicConfig;
    let bankName = pub.bankName?.trim() ?? '';
    let accountHolder = pub.accountHolder?.trim() ?? '';
    let iban = pub.iban?.trim() ?? '';
    let description = pub.description?.trim() ?? '';

    if (!bankName || !iban) {
      const creds = await this.getDecryptedCredentials<BankTransferCredentials>(tenantId, 'BANK_TRANSFER');
      if (creds) {
        bankName = bankName || String(creds.bankName ?? '').trim();
        accountHolder = accountHolder || String(creds.accountHolder ?? '').trim();
        iban = iban || String(creds.iban ?? '').trim();
        description = description || String(creds.description ?? '').trim();
      }
    }

    if (!bankName || !iban) return null;

    return {
      bankName,
      accountHolder: accountHolder || '—',
      iban,
      description,
    };
  }

  private emptyAdminView(provider: PaymentProviderType): AdminPaymentSettingView {
    return {
      provider,
      isActive:       false,
      isTestMode:     true,
      displayName:    null,
      publicConfig:   null,
      credentials:    this.defaultCredentialShape(provider),
      hasCredentials: false,
    };
  }

  private defaultCredentialShape(provider: PaymentProviderType): Record<string, string | null> {
    switch (provider) {
      case 'PAYTR':
        return { merchantId: null, merchantKey: null, merchantSalt: null };
      case 'IYZICO':
        return { apiKey: null, secretKey: null, baseUrl: null };
      case 'BANK_TRANSFER':
        return { bankName: null, accountHolder: null, iban: null, description: null };
      case 'CASH_ON_DELIVERY':
        return { extraFee: null, description: null };
      case 'BANK_POS':
        return {
          bankName: null, clientId: null, storeKey: null,
          apiUser: null, apiPassword: null, endpoint: null,
        };
      default:
        return {};
    }
  }

  private toAdminView(row: {
    provider: PaymentProviderType;
    isActive: boolean;
    isTestMode: boolean;
    displayName: string | null;
    publicConfigJson: unknown;
    credentialsEncrypted: string | null;
  }): AdminPaymentSettingView {
    const creds = decryptJson<Record<string, unknown>>(row.credentialsEncrypted) ?? {};
    const masked = this.maskCredentials(row.provider, creds);
    return {
      provider:     row.provider,
      isActive:     row.isActive,
      isTestMode:   row.isTestMode,
      displayName:  row.displayName,
      publicConfig: (row.publicConfigJson as Record<string, unknown>) ?? null,
      credentials:  masked,
      hasCredentials: Boolean(row.credentialsEncrypted),
    };
  }

  private maskCredentials(
    provider: PaymentProviderType,
    creds: Record<string, unknown>,
  ): Record<string, string | boolean | number | null> {
    const mask = (v: unknown) => (v != null && String(v).length > 0 ? SECRET_PLACEHOLDER : null);
    switch (provider) {
      case 'PAYTR':
        return {
          merchantId:   creds.merchantId != null ? String(creds.merchantId) : null,
          merchantKey:  mask(creds.merchantKey),
          merchantSalt: mask(creds.merchantSalt),
        };
      case 'IYZICO':
        return { apiKey: mask(creds.apiKey), secretKey: mask(creds.secretKey), baseUrl: creds.baseUrl != null ? String(creds.baseUrl) : null };
      case 'BANK_TRANSFER':
        return {
          bankName:      creds.bankName != null ? String(creds.bankName) : null,
          accountHolder: creds.accountHolder != null ? String(creds.accountHolder) : null,
          iban:          creds.iban != null ? maskIban(String(creds.iban)) : null,
          description:   creds.description != null ? String(creds.description) : null,
        };
      case 'CASH_ON_DELIVERY':
        return {
          extraFee:    creds.extraFee != null ? Number(creds.extraFee) : null,
          description: creds.description != null ? String(creds.description) : null,
        };
      case 'BANK_POS':
        return {
          bankName:    creds.bankName != null ? String(creds.bankName) : null,
          clientId:    mask(creds.clientId),
          storeKey:    mask(creds.storeKey),
          apiUser:     mask(creds.apiUser),
          apiPassword: mask(creds.apiPassword),
          endpoint:    creds.endpoint != null ? String(creds.endpoint) : null,
        };
      default:
        return {};
    }
  }

  private buildPayload(
    provider: PaymentProviderType,
    body: Record<string, unknown>,
    existing: Record<string, unknown>,
  ): { credentials: Record<string, unknown>; publicConfig: Record<string, unknown> | undefined } {
    const pickSecret = (key: string) => {
      const v = body[key];
      if (v === undefined || v === null || v === '' || v === SECRET_PLACEHOLDER) {
        return existing[key];
      }
      return String(v).trim();
    };

    switch (provider) {
      case 'PAYTR': {
        const credentials: PaytrCredentials = {
          merchantId:   pickSecret('merchantId') as string,
          merchantKey:  pickSecret('merchantKey') as string,
          merchantSalt: pickSecret('merchantSalt') as string,
        };
        return { credentials: credentials as unknown as Record<string, unknown>, publicConfig: undefined };
      }
      case 'IYZICO': {
        const credentials: IyzicoCredentials = {
          apiKey:    pickSecret('apiKey') as string,
          secretKey: pickSecret('secretKey') as string,
          baseUrl:   body.baseUrl != null ? String(body.baseUrl) : (existing.baseUrl as string | undefined),
        };
        return { credentials: credentials as unknown as Record<string, unknown>, publicConfig: undefined };
      }
      case 'BANK_TRANSFER': {
        const bank: BankTransferCredentials = {
          bankName:      String(body.bankName ?? existing.bankName ?? ''),
          accountHolder: String(body.accountHolder ?? existing.accountHolder ?? ''),
          iban:          String(body.iban ?? existing.iban ?? ''),
          description:   body.description != null ? String(body.description) : (existing.description as string | undefined),
        };
        const publicConfig: BankTransferPublicConfig = {
          bankName:      bank.bankName,
          accountHolder: bank.accountHolder,
          iban:          bank.iban,
          description:   bank.description,
        };
        return { credentials: bank as unknown as Record<string, unknown>, publicConfig };
      }
      case 'CASH_ON_DELIVERY': {
        const extraFee = body.extraFee != null ? Number(body.extraFee) : Number(existing.extraFee ?? 0);
        const description = body.description != null ? String(body.description) : (existing.description as string | undefined);
        const publicConfig: CashOnDeliveryPublicConfig = { extraFee, description };
        return {
          credentials: { extraFee, description } as Record<string, unknown>,
          publicConfig,
        };
      }
      case 'BANK_POS': {
        const credentials: BankPosCredentials = {
          bankName:    body.bankName != null ? String(body.bankName) : (existing.bankName as string | undefined),
          clientId:    pickSecret('clientId') as string | undefined,
          storeKey:    pickSecret('storeKey') as string | undefined,
          apiUser:     pickSecret('apiUser') as string | undefined,
          apiPassword: pickSecret('apiPassword') as string | undefined,
          endpoint:    body.endpoint != null ? String(body.endpoint) : (existing.endpoint as string | undefined),
        };
        return { credentials: credentials as unknown as Record<string, unknown>, publicConfig: undefined };
      }
      default:
        return { credentials: {}, publicConfig: undefined };
    }
  }
}

export const tenantPaymentSettingsService = new TenantPaymentSettingsService();
