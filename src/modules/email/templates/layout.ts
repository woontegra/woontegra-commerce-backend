export function emailLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
  <style>
    body { margin:0; padding:0; background:#f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width:600px; margin:32px auto; }
    .header  { background:#1e40af; padding:28px 32px; border-radius:12px 12px 0 0; text-align:center; }
    .header h1 { margin:0; color:#fff; font-size:20px; font-weight:700; }
    .body    { background:#fff; padding:32px; border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0; }
    .footer  { background:#f8fafc; border:1px solid #e2e8f0; border-top:none; padding:16px 32px; border-radius:0 0 12px 12px; text-align:center; }
    .footer p { margin:0; color:#94a3b8; font-size:12px; }
    h2  { margin:0 0 8px; color:#0f172a; font-size:22px; font-weight:700; }
    p   { margin:0 0 16px; color:#475569; line-height:1.6; font-size:15px; }
    .btn { display:inline-block; background:#1e40af; color:#fff !important; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:600; font-size:14px; margin:8px 0 16px; }
    .card { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin:16px 0; }
    .card-row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #e2e8f0; font-size:14px; }
    .card-row:last-child { border-bottom:none; }
    .label { color:#64748b; }
    .value { color:#0f172a; font-weight:600; }
    .badge-green  { display:inline-block; background:#dcfce7; color:#15803d; padding:4px 12px; border-radius:99px; font-size:13px; font-weight:600; }
    .badge-red    { display:inline-block; background:#fee2e2; color:#dc2626; padding:4px 12px; border-radius:99px; font-size:13px; font-weight:600; }
    .badge-amber  { display:inline-block; background:#fef9c3; color:#b45309; padding:4px 12px; border-radius:99px; font-size:13px; font-weight:600; }
    .divider { border:none; border-top:1px solid #e2e8f0; margin:24px 0; }
    code { background:#f1f5f9; padding:2px 6px; border-radius:4px; font-size:13px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>Woontegra</h1></div>
    <div class="body">${body}</div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Woontegra. Tüm hakları saklıdır.</p>
      <p>Bu e-posta otomatik olarak gönderilmiştir, lütfen yanıtlamayınız.</p>
    </div>
  </div>
</body>
</html>`;
}

export function frontendUrl(path = ''): string {
  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  return path ? `${base}${path.startsWith('/') ? path : `/${path}`}` : base;
}
