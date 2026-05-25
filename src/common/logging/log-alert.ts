import type { NormalizedLogRecord } from './normalize';

const recentAlerts = new Map<string, number>();
const ALERT_COOLDOWN_MS = 60_000;

function alertKey(record: NormalizedLogRecord): string {
  return `${record.module}:${record.action}:${record.errorMessage ?? record.message}`.slice(0, 200);
}

function shouldSendAlert(key: string): boolean {
  const now = Date.now();
  const last = recentAlerts.get(key) ?? 0;
  if (now - last < ALERT_COOLDOWN_MS) return false;
  recentAlerts.set(key, now);
  if (recentAlerts.size > 500) {
    const cutoff = now - ALERT_COOLDOWN_MS * 2;
    for (const [k, t] of recentAlerts) {
      if (t < cutoff) recentAlerts.delete(k);
    }
  }
  return true;
}

function buildDiscordBody(record: NormalizedLogRecord): object {
  const fields = [
    { name: 'Module', value: record.module, inline: true },
    { name: 'Action', value: record.action, inline: true },
    { name: 'Status', value: record.status, inline: true },
    ...(record.traceId ? [{ name: 'Trace ID', value: record.traceId, inline: false }] : []),
    ...(record.tenantId ? [{ name: 'Tenant', value: record.tenantId, inline: true }] : []),
    ...(record.userId ? [{ name: 'User', value: record.userId, inline: true }] : []),
  ];

  const description = [
    record.errorMessage ?? record.message,
    record.stack ? `\n\`\`\`\n${record.stack.slice(0, 1200)}\n\`\`\`` : '',
  ].join('');

  return {
    embeds: [{
      title:       '🚨 Production Error',
      description: description.slice(0, 4000),
      color:       0xE74C3C,
      fields,
      timestamp:   record.timestamp,
    }],
  };
}

function buildSlackBody(record: NormalizedLogRecord): object {
  const lines = [
    `*🚨 Error* [${record.module}] \`${record.action}\``,
    record.errorMessage ?? record.message,
    record.traceId ? `traceId: \`${record.traceId}\`` : null,
    record.tenantId ? `tenantId: \`${record.tenantId}\`` : null,
    record.stack ? `\`\`\`${record.stack.slice(0, 1500)}\`\`\`` : null,
  ].filter(Boolean);

  return { text: lines.join('\n') };
}

function buildWebhookBody(url: string, record: NormalizedLogRecord): object {
  if (url.includes('discord.com/api/webhooks')) return buildDiscordBody(record);
  if (url.includes('hooks.slack.com')) return buildSlackBody(record);
  return buildSlackBody(record);
}

/** error seviyesi logları → Slack/Discord webhook (LOG_ALERT_WEBHOOK_URL) */
export function dispatchErrorAlert(record: NormalizedLogRecord): void {
  const url = process.env.LOG_ALERT_WEBHOOK_URL?.trim();
  if (!url || record.level !== 'error') return;

  const key = alertKey(record);
  if (!shouldSendAlert(key)) return;

  const body = buildWebhookBody(url, record);

  void fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  }).catch(() => {
    // Alert kanalı kırık olsa bile uygulama akışını bozma
  });
}
