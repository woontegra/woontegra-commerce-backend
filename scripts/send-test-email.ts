// @ts-nocheck
/**
 * Örnek e-posta — kuyruğa ekler (worker çalışıyor olmalı).
 *
 *   set EMAIL_PROVIDER=resend
 *   set EMAIL_API_KEY=re_xxx
 *   set EMAIL_FROM=onboarding@yourdomain.com
 *   npx ts-node --transpile-only scripts/send-test-email.ts you@example.com
 *
 * SMTP:
 *   set EMAIL_PROVIDER=smtp
 *   set EMAIL_HOST=smtp.example.com
 *   set EMAIL_USER=...
 *   set EMAIL_API_KEY=password
 */

require('dotenv').config();

const { deliverEmail } = require('../src/modules/email/email.provider');
const { passwordResetTemplateSample } = require('../src/modules/email/templates/password-reset');
const { errorAlertTemplateSample } = require('../src/modules/email/templates/error-alert');
const { subscriptionNotificationTemplate } = require('../src/modules/email/templates/subscription');

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error('Kullanım: npx ts-node --transpile-only scripts/send-test-email.ts <alici@email.com> [password|subscription|error]');
    process.exit(1);
  }

  const kind = (process.argv[3] || 'password').toLowerCase();

  let tpl;
  if (kind === 'subscription') {
    tpl = subscriptionNotificationTemplate({
      tenantName: 'Demo Mağaza',
      plan: 'PRO',
      billingCycle: 'MONTHLY',
      endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      status: 'activated',
    });
  } else if (kind === 'error') {
    tpl = errorAlertTemplateSample();
  } else {
    tpl = passwordResetTemplateSample();
  }

  console.log('Gönderiliyor:', to, '—', tpl.subject);
  const result = await deliverEmail({ to, subject: tpl.subject, html: tpl.html });
  console.log('Tamam:', result);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
