import dns from 'node:dns/promises';

function normHost(h: string): string {
  return h.trim().toLowerCase().replace(/\.$/, '');
}

function targetsMatch(actual: string, expected: string): boolean {
  const a = normHost(actual);
  const e = normHost(expected);
  return a === e || a.endsWith(`.${e}`);
}

/**
 * Custom domain DNS doğrulaması:
 * - CNAME hedefi DOMAIN_VERIFY_CNAME_TARGET (varsayılan app.woontegra.com)
 * - veya A/AAAA DOMAIN_VERIFY_A_IPV4 / DOMAIN_VERIFY_A_IPV6 (virgülle)
 */
export async function verifyCustomDomainDns(hostname: string): Promise<{ ok: boolean; detail: string }> {
  const host = normHost(hostname);
  if (!host || !host.includes('.') || host.length < 4) {
    return { ok: false, detail: 'Geçersiz domain (FQDN gerekli).' };
  }

  const expectCname = normHost(process.env.DOMAIN_VERIFY_CNAME_TARGET || 'app.woontegra.com');
  const expectA4 = (process.env.DOMAIN_VERIFY_A_IPV4 || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const expectA6 = (process.env.DOMAIN_VERIFY_A_IPV6 || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const cnames = await dns.resolveCname(host);
    for (const c of cnames) {
      if (targetsMatch(c, expectCname)) {
        return { ok: true, detail: `CNAME doğru: ${c} → ${expectCname}` };
      }
    }
  } catch {
    // not a CNAME leaf / NXDOMAIN — try A
  }

  try {
    const ips4 = await dns.resolve4(host);
    if (expectA4.length && ips4.some((ip) => expectA4.includes(ip))) {
      return { ok: true, detail: `A kaydı eşleşti: ${ips4.join(', ')}` };
    }
    if (!expectA4.length && ips4.length) {
      return {
        ok:        false,
        detail:    `A kaydı var (${ips4.join(', ')}) fakat DOMAIN_VERIFY_A_IPV4 tanımlı değil.`,
      };
    }
  } catch {
    // ignore
  }

  if (expectA6.length) {
    try {
      const ips6 = await dns.resolve6(host);
      if (ips6.some((ip) => expectA6.includes(ip))) {
        return { ok: true, detail: `AAAA kaydı eşleşti: ${ips6.join(', ')}` };
      }
    } catch {
      // ignore
    }
  }

  return {
    ok:     false,
    detail:
      'Beklenen CNAME veya A/AAAA kaydı bulunamadı. CNAME hedefi: ' +
      expectCname +
      (expectA4.length ? ` veya A: ${expectA4.join(', ')}` : ''),
  };
}
