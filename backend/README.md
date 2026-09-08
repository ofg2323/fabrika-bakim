# Fabrika Bakım Yönetimi — Modüler Backend API (Tam Sürüm)

Bu, tek dosyalık HTML uygulamasının **modüler backend + gerçek PostgreSQL veritabanı**
tam sürümüdür. Projedeki tüm modüller eksiksiz olarak geliştirilmiştir:

- **Kimlik Doğrulama** (`/api/auth`) — giriş, ilk yönetici oluşturma, JWT oturum yönetimi
- **Kullanıcılar** (`/api/users`) — CRUD, rol bazlı yetkilendirme (`Yönetici`, `Teknisyen`, `Depo Sorumlusu`)
- **Varlık Grupları** (`/api/asset-groups`) — periyot, muayene ve dış bakım ayarları
- **Varlıklar** (`/api/assets`) — CRUD, ekler (güvenli dosya yükleme), yedek parça bağlantıları, geçmiş
- **Tedarikçiler** (`/api/suppliers`) — CRUD, firma ve yetkili kişi araması
- **Malzemeler** (`/api/materials`) — CRUD, kritik stok seviyesi filtresi, hızlı stok düzeltme (`/adjust`)
- **Stok Hareketleri & Özet** (`/api/stock`) — stok giriş/çıkış günlükleri ve anlık KPI özetleri (`/summary`)
- **İhtiyaç Listesi** (`/api/needs-list`) — malzeme talepleri, otomatik kritik stok tespiti (`?includeAuto=true`), durum yönetimi
- **Satın Alma** (`/api/purchases`) — satın alma kayıtları, otomatik stok girişi ve ihtiyaç karşılama (atomik transaction)
- **Bakımlar** (`/api/maintenance`) — periyodik ve arızi bakımlar, kontrol listesi sonuçları, yedek parça sarfiyatı ve stok düşümü, takip numarası (`B00001`)
- **Arızalar** (`/api/faults`) — arıza bildirme, teknisyen atama, parça sarfiyatı, görsel/belge yükleme, otomatik varlık durum güncellemesi ('Arızalı' <-> 'Aktif'), takip numarası (`A00001`)
- **Muayeneler** (`/api/inspections`) — çoklu varlık kapsayan grup muayeneleri, yüklenici firma, sertifika/rapor yükleme, varlık muayene tarihi güncellemesi, takip numarası (`C00001`)
- **Dış Bakım** (`/api/ext-maintenance`) — taşeron/servis dış bakımları, çoklu varlık bağlama, servis sertifikaları, takip numarası (`D00001`)
- **Projeler** (`/api/projects`) — proje görevleri (`tasks`), tedarikçi teklifleri (`quotes`), bütçe geçmişi ve ilerleme logları, takip numarası (`P00001`)
- **Baskı & Sistem Ayarları** (`/api/settings`) — fabrika adı, logo yükleme, form yazdırma görünürlük ve kural ayarları (`print_template`)

## Kurulum

1. **PostgreSQL kurun** (kendi sunucunuzda veya bir bulut sağlayıcısında — ör. Railway, Supabase, Neon, DigitalOcean).
2. Bir veritabanı ve kullanıcı oluşturun.
3. Bu klasörde:
   ```bash
   npm install
   cp .env.example .env
   # .env içindeki DATABASE_URL ve JWT_SECRET değerlerini kendi bilgilerinizle doldurun
   npm run db:init   # schema.sql'i veritabanına uygular
   npm start         # sunucuyu başlatır (varsayılan: http://localhost:3001)
   ```
4. İlk yönetici hesabını oluşturmak için:
   ```bash
   curl -X POST http://localhost:3001/api/auth/first-admin \
     -H "Content-Type: application/json" \
     -d '{"name":"Ahmet Yılmaz","password":"guvenli-bir-sifre"}'
   ```
5. Giriş yapmak için:
   ```bash
   curl -X POST http://localhost:3001/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"userId":"<yukarıdaki cevaptan gelen id>","password":"guvenli-bir-sifre"}'
   ```
   Dönen `token` değerini sonraki tüm isteklerde `Authorization: Bearer <token>` başlığıyla kullanın.

## Güvenlik ve Mimari Özellikleri

- **Güvenlik Başlıkları & Rate Limiting**: `helmet` ve `express-rate-limit` ile kaba kuvvet ve web saldırılarına karşı koruma.
- **Güvenli Dosya Yükleme**: `multer` ile MIME type / uzantı filtreleme (yalnızca JPG, PNG, WEBP, PDF) ve Path Traversal korumalı dosya silme.
- **Atomik Veritabanı İşlemleri**: Stok hareketleri ve satın alma kayıtları `BEGIN ... COMMIT` transaction'ları ile korunur.
- **Foreign Key İndeksleri**: Tüm dış anahtarlar indekslenerek JOIN ve kaskat silme performansları optimize edilmiştir.
- **Zarif Kapatma (Graceful Shutdown)**: `SIGINT` / `SIGTERM` sinyallerinde HTTP sunucusu ve veritabanı havuzu bağlantıları temiz şekilde kapatılır.

## Testler

Entegrasyon testlerini çalıştırmak için önce sunucuyu (`npm start`) başlatın, ardından ayrı bir terminalde testleri yürütün:

```bash
npm test
```

Projenin tam mimari şeması, tüm API uç noktaları listesi, PWA ve üretim ortamı dağıtım yönergeleri için lütfen kök dizindeki [README.md](../README.md) dosyasına başvurun.
