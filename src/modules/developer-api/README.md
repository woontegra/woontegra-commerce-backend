# Developer API Modülü (Placeholder)

> **Durum:** Henüz aktif değil · Kod yok · Route mount edilmedi

Bu klasör, Woontegra **Public API / Developer API** (`/api/v1/*`) geliştirmesi için ayrılmıştır.

Merkezi plan: [`DEVELOPER_API_ROADMAP.md`](../../../../DEVELOPER_API_ROADMAP.md) (proje kökü)

---

## Önemli kurallar

1. **Bu modül henüz aktif değildir.** Controller, service veya route dosyası eklenene kadar dış istek kabul edilmez.
2. **Public API burada geliştirilecektir.** Admin panel API’si (`/api/admin/*`, mevcut auth middleware) dış entegrasyon için **kullanılmayacaktır**.
3. **API key, scopes, rate limit ve audit log tamamlanmadan controller açılmayacaktır.** Güvenlik katmanları olmadan endpoint mount edilmez.
4. **Feature flag:** Production’da varsayılan `DEVELOPER_API_ENABLED=false` olacak (Faz 1A).
5. Bu README dışında TypeScript dosyası eklenmeden build etkilenmez.

---

## Planlanan dosya yapısı (Faz 1A+)

```
developer-api/
├── README.md                          ← bu dosya
├── developer-api.module.ts            ← Nest modül kaydı (Faz 1A)
├── developer-api.controller.ts        ← /api/v1/* route’ları (Faz 1B+)
├── developer-api.service.ts           ← orchestration
├── guards/
│   ├── api-key.guard.ts               ← API key doğrulama + tenantId
│   └── api-scope.guard.ts             ← products:read vb. scope kontrolü
├── middleware/
│   └── api-rate-limit.middleware.ts   ← key/tenant bazlı limit
├── services/
│   ├── webhook.service.ts             ← webhook kayıt + dispatch
│   └── developer-api-audit.service.ts ← istek audit log
└── dto/                               ← request/response DTO’lar
```

---

## Planlanan endpoint’ler (henüz uygulanmadı)

| Method | Route |
|--------|-------|
| GET | `/api/v1/products` |
| GET | `/api/v1/products/:id` |
| POST | `/api/v1/products` |
| PATCH | `/api/v1/products/:id` |
| GET | `/api/v1/orders` |
| GET | `/api/v1/orders/:id` |
| PATCH | `/api/v1/orders/:id/status` |
| GET | `/api/v1/customers` |
| GET | `/api/v1/stock` |
| PATCH | `/api/v1/stock/:productId` |
| POST | `/api/v1/webhooks` |
| GET | `/api/v1/webhooks` |
| DELETE | `/api/v1/webhooks/:id` |

---

## İlgili dokümanlar

- [`API_KEY_RATE_LIMIT_README.md`](../../../../API_KEY_RATE_LIMIT_README.md)
- [`WEBHOOK_SYSTEM_README.md`](../../../../WEBHOOK_SYSTEM_README.md)
- [`DEVELOPER_API_ROADMAP.md`](../../../../DEVELOPER_API_ROADMAP.md)

---

## Geliştirmeye başlamadan önce

1. `DEVELOPER_API_ROADMAP.md` Faz 1A maddelerini oku.
2. Tenant isolation test stratejisini belirle.
3. Mevcut admin auth ile public API auth’u **karıştırma**.
4. PR’da “Public API endpoint açıldı mı?” checklist’ini doldur.
