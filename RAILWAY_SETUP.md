# 🚀 Railway Deployment - Final Steps

## ✅ Build Başarılı!

Backend başarıyla build edildi. Şimdi sadece environment variable'ları eklemen gerekiyor.

## 📋 Railway Dashboard'da Yapılacaklar

### 1. PostgreSQL Servisini Ekle (Henüz eklemediysen)

1. Railway dashboard'a git
2. Projeye "New Service" → "Database" → "Add PostgreSQL" tıkla
3. PostgreSQL servisi otomatik oluşturulacak

### 2. Environment Variables Ekle

Backend servisine git → **Variables** sekmesine tıkla → Şu variable'ları ekle:

#### Gerekli Environment Variables:

```bash
# PostgreSQL Connection (Railway'den otomatik gelecek)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# JWT Secret (güçlü bir key gir)
JWT_SECRET=your-super-secret-jwt-key-min-32-characters-long

# Node Environment
NODE_ENV=production

# Port (Railway otomatik ayarlar ama ekleyebilirsin)
PORT=3000
```

#### DATABASE_URL Nasıl Bağlanır?

Railway'de PostgreSQL servisi varsa:
1. Backend service → Variables
2. "New Variable" → "Add Reference"
3. Service: PostgreSQL seçin
4. Variable: `DATABASE_URL` seçin
5. Save

Veya manuel olarak PostgreSQL connection string'i kopyala yapıştır.

### 3. Servisi Yeniden Başlat

Environment variable'ları ekledikten sonra:
- Railway otomatik redeploy edecek
- Veya "Deploy" → "Redeploy" tıkla

### 4. Migration'ları Çalıştır

Deploy başarılı olduktan sonra:

1. Railway dashboard → Backend service
2. Sağ üstten **"Shell"** veya **"Terminal"** aç
3. Şu komutu çalıştır:

```bash
npm run prisma:migrate:deploy
```

Bu komut database tablolarını oluşturacak.

### 5. Test Et

Deploy tamamlandıktan sonra:

```bash
curl https://your-app-url.railway.app/health
```

Başarılı response:
```json
{
  "status": "success",
  "message": "Woontegra E-Commerce SaaS API is running",
  "timestamp": "2026-04-05T..."
}
```

## 🔍 Sorun Giderme

### "DATABASE_URL is not defined" Hatası

✅ **Çözüm:** Railway dashboard'da `DATABASE_URL` environment variable'ını ekle.

### "JWT_SECRET is not defined" Hatası

✅ **Çözüm:** Railway dashboard'da `JWT_SECRET` environment variable'ını ekle.

### Migration Hatası

Railway terminal'de şunu çalıştır:
```bash
npx prisma migrate deploy
```

## 📊 Deployment URL

Railway deployment tamamlandıktan sonra:
- **Backend URL:** `https://your-backend.railway.app`
- **Health Check:** `https://your-backend.railway.app/health`

## 🎯 API Endpoints

Tüm endpoint'ler için `README.md` dosyasına bak.

## 🔐 Güvenlik Notları

Production'da:
- ✅ `JWT_SECRET` en az 32 karakter olmalı
- ✅ `DATABASE_URL` güvenli tutulmalı
- ✅ CORS ayarlarını production domain'e göre yapılandır
- ✅ Rate limiting ekle (opsiyonel)

## 📞 Destek

Sorun yaşarsan Railway logs'larını kontrol et:
- Railway dashboard → Backend service → "Logs"
