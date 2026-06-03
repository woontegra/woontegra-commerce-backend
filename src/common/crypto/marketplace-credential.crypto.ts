import crypto from 'crypto';
import { logger } from '../../config/logger';

const ENC_PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-cbc';
const IV_BYTES = 16;
const KEY_BYTES = 32;
/** marketplace.service.ts ile uyumlu (mevcut şifreli MarketplaceAccount kayıtları) */
const SCRYPT_SALT = 'salt';

/** Legacy format: 32-char hex IV + ciphertext (marketplace.service.ts) */
const LEGACY_IV_CIPHER = /^[0-9a-f]{32}:[0-9a-f]+$/i;

export const MARKETPLACE_CREDENTIAL_SAVE_BLOCKED_MESSAGE =
  'Trendyol API bilgileri güvenli şekilde saklanamıyor. Lütfen sistem yöneticisi ile iletişime geçin.';

export class MarketplaceCredentialSaveBlockedError extends Error {
  readonly statusCode = 503;

  constructor(message = MARKETPLACE_CREDENTIAL_SAVE_BLOCKED_MESSAGE) {
    super(message);
    this.name = 'MarketplaceCredentialSaveBlockedError';
  }
}

let cachedKey: Buffer | null = null;

export function isMarketplaceEncryptionKeyConfigured(): boolean {
  const raw = process.env.MARKETPLACE_ENCRYPTION_KEY?.trim();
  return Boolean(raw && raw.length >= 16);
}

/** Production'da kimlik bilgisi kaydı için zorunlu; development'ta yalnızca uyarı. */
export function assertMarketplaceCredentialSaveAllowed(): void {
  if (isMarketplaceEncryptionKeyConfigured()) return;

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    throw new MarketplaceCredentialSaveBlockedError();
  }

  logger.warn({
    message:
      'MARKETPLACE_ENCRYPTION_KEY tanımlı değil — development ortamında Trendyol kimlik bilgileri şifrelenmeden kaydedilecek.',
  });
}

export function assertMarketplaceEncryptionKeyConfigured(): void {
  getEncryptionKey();
}

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.MARKETPLACE_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      'MARKETPLACE_ENCRYPTION_KEY ortam değişkeni tanımlı değil. ' +
        'Üretim için en az 32 karakter rastgele bir secret kullanın.',
    );
  }
  if (raw.length < 16) {
    throw new Error(
      'MARKETPLACE_ENCRYPTION_KEY çok kısa (minimum 16 karakter, önerilen 32+).',
    );
  }

  cachedKey = crypto.scryptSync(raw, SCRYPT_SALT, KEY_BYTES);
  return cachedKey;
}

export function isCredentialEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  if (value.startsWith(ENC_PREFIX)) return true;
  return LEGACY_IV_CIPHER.test(value);
}

/** Trendyol kimlik bilgisi kaydı — production'da key zorunlu, development'ta key yoksa düz metin. */
export function encryptCredentialForSave(plaintext: string): string {
  if (plaintext == null || plaintext === '') return plaintext;

  assertMarketplaceCredentialSaveAllowed();

  if (!isMarketplaceEncryptionKeyConfigured()) {
    return plaintext;
  }

  return encryptCredential(plaintext);
}

export function encryptCredential(plaintext: string): string {
  if (plaintext == null || plaintext === '') return plaintext;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${ENC_PREFIX}${iv.toString('hex')}:${encrypted}`;
}

export function decryptCredential(stored: string | null | undefined): string {
  if (stored == null || stored === '') return stored ?? '';

  if (stored.startsWith(ENC_PREFIX)) {
    return decryptIvCipher(stored.slice(ENC_PREFIX.length));
  }

  if (LEGACY_IV_CIPHER.test(stored)) {
    return decryptIvCipher(stored);
  }

  // Pre-migration plaintext
  return stored;
}

function decryptIvCipher(ivCipher: string): string {
  const parts = ivCipher.split(':');
  if (parts.length < 2) {
    throw new Error('Geçersiz şifreli credential formatı.');
  }
  const ivHex = parts[0];
  const encryptedHex = parts.slice(1).join(':');
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  if (iv.length !== IV_BYTES) {
    throw new Error('Geçersiz credential IV uzunluğu.');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export type TrendyolCredentialRow = {
  apiKey: string;
  apiSecret: string;
  token?: string | null;
  supplierId: string;
};

/** DB satırından Trendyol API client için düz metin credential */
export function decryptTrendyolCredentials(row: TrendyolCredentialRow): {
  apiKey: string;
  apiSecret: string;
  token?: string;
  sellerId: string;
} {
  return {
    apiKey:    decryptCredential(row.apiKey),
    apiSecret: decryptCredential(row.apiSecret),
    token:     row.token ? decryptCredential(row.token) : undefined,
    sellerId:  row.supplierId,
  };
}
