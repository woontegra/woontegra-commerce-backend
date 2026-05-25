// @ts-nocheck
/**
 * Credential crypto smoke test
 *
 *   set MARKETPLACE_ENCRYPTION_KEY=... (32+ char)
 *   npx ts-node scripts/test-marketplace-credential-crypto.ts
 */

import {
  decryptCredential,
  encryptCredential,
  isCredentialEncrypted,
} from '../src/common/crypto/marketplace-credential.crypto';

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function run() {
  const sample = 'test-api-key-12345';
  const secret = 'test-secret-abcdef';

  const encKey = encryptCredential(sample);
  const encSec = encryptCredential(secret);

  check(encKey.startsWith('enc:v1:'), 'encrypted key must use enc:v1 prefix');
  check(isCredentialEncrypted(encKey), 'isCredentialEncrypted true for new format');
  check(decryptCredential(encKey) === sample, 'round-trip apiKey');
  check(decryptCredential(encSec) === secret, 'round-trip apiSecret');

  const legacyEnc = encryptCredential('legacy').replace('enc:v1:', '');
  check(legacyEnc.includes(':'), 'legacy body has iv:cipher');
  check(decryptCredential(legacyEnc) === 'legacy', 'legacy format decrypt');

  check(decryptCredential('plain-key') === 'plain-key', 'plaintext passthrough');

  // eslint-disable-next-line no-console
  console.log('OK marketplace-credential.crypto smoke tests passed');
}

run();
