import { EMAIL_TEMPLATE_KEYS, type EmailTemplateKey } from './email-template.keys';

const SYSTEM_KEY_SET = new Set<string>(EMAIL_TEMPLATE_KEYS);
const CUSTOM_PREFIX = 'custom_';

export function slugifyTemplateCode(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

export function isSystemTemplateKey(key: string): key is EmailTemplateKey {
  return SYSTEM_KEY_SET.has(key);
}

export function isCustomTemplateKey(key: string): boolean {
  return key.startsWith(CUSTOM_PREFIX) && !isSystemTemplateKey(key);
}

/** Panelden girilen şablon kodu → tenant içi benzersiz anahtar */
export function normalizeCustomTemplateCode(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  let code = trimmed
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!code.startsWith(CUSTOM_PREFIX)) {
    code = `${CUSTOM_PREFIX}${code}`;
  }

  if (isSystemTemplateKey(code)) return null;
  if (!/^custom_[a-z0-9][a-z0-9_]{0,62}$/.test(code)) return null;
  return code;
}

export async function generateUniqueCustomTemplateCode(
  tenantId: string,
  name: string,
  exists: (key: string) => Promise<boolean>,
): Promise<string> {
  const base = slugifyTemplateCode(name) || 'sablon';
  let candidate = `${CUSTOM_PREFIX}${base}`;
  let suffix = 0;

  while (await exists(candidate)) {
    suffix += 1;
    candidate = `${CUSTOM_PREFIX}${base}_${suffix}`;
  }

  return candidate;
}
