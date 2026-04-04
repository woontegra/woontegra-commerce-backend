# Railway Deployment Guide

## 🚀 Railway'de Deploy Etme Adımları

### 1. Railway'de PostgreSQL Oluştur
1. Railway dashboard'a git
2. "New Project" → "Provision PostgreSQL"
3. PostgreSQL servisini oluştur
4. Connection string'i kopyala

### 2. Backend Servisini Ekle
1. Aynı projede "New Service" → "GitHub Repo"
2. Bu repository'yi seç
3. Root directory'yi `/backend` olarak ayarla

### 3. Environment Variables Ekle
Railway dashboard'da backend servisine şu environment variable'ları ekle:

```
DATABASE_URL=<PostgreSQL connection string>
JWT_SECRET=your-super-secret-jwt-key-change-this
PORT=3000
NODE_ENV=production
```

**ÖNEMLİ:** `DATABASE_URL` Railway PostgreSQL servisinden otomatik gelecek, sadece reference et.

### 4. Build Settings
Railway otomatik olarak şu ayarları kullanacak:
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Install Command**: `npm install` (otomatik Prisma generate çalışacak)

### 5. Migration'ları Çalıştır
İlk deploy'dan sonra Railway dashboard'da terminal aç ve şunu çalıştır:
```bash
npm run prisma:migrate:deploy
```

### 6. Deploy
- Git push yap
- Railway otomatik deploy edecek
- Deploy loglarını izle

## 🔧 Sorun Giderme

### Build Hatası Alıyorsan
1. `tsconfig.json` güncel mi kontrol et (moduleResolution: "bundler")
2. `package.json` içinde `postinstall` script'i var mı kontrol et
3. Railway loglarını kontrol et

### Database Bağlantı Hatası
1. `DATABASE_URL` environment variable'ı doğru mu?
2. PostgreSQL servisi çalışıyor mu?
3. Migration'lar çalıştırıldı mı?

### Prisma Hatası
Railway terminal'de şunu çalıştır:
```bash
npx prisma generate
npx prisma migrate deploy
```

## 📡 API Test
Deploy edildikten sonra:
```bash
curl https://your-app.railway.app/health
```

## 🔐 Güvenlik
Production'da mutlaka:
- `JWT_SECRET` değiştir (güçlü bir key kullan)
- `DATABASE_URL` güvenli tut
- CORS ayarlarını production domain'e göre ayarla

## 📊 Monitoring
Railway dashboard'dan:
- CPU/Memory kullanımını izle
- Logs'ları kontrol et
- Metrics'leri gözlemle
