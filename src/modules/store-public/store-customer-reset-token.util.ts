import crypto from 'crypto';

/** Düz metin token üretir (yalnızca e-posta linkinde; DB'de hash saklanır). */
export function generatePasswordResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashPasswordResetToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}
