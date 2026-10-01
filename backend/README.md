# Fabrika Bakım Yönetimi — Modüler Backend API (Tam Sürüm)

Bu, tek dosyalık HTML uygulamasının **modüler backend + gerçek PostgreSQL veritabanı**
tam sürümüdür. Projedeki tüm modüller eksiksiz olarak geliştirilmiştir:

- **Kimlik Doğrulama** (`/api/auth`) — giriş, ilk yönetici oluşturma, JWT oturum yönetimi
- **Kullanıcılar** (`/api/users`) — CRUD, rol bazlı yetkilendirme (`Yönetici`, `Bakımcı`, `Teknisyen`, `Depo Sorumlusu`, `Operatör`)
- **Varlık Grupları** (`/api/asset-groups`) — periyot, muayene, dış bakım ve kalibrasyon periyot ayarları
- **Varlıklar** (`/api/assets`) — CRUD, ekler (güvenli dosya yükleme), yedek parça bağlantıları, geçmiş ve maliyet analizi
- **Tedarikçiler** (`/api/suppliers`) — CRUD, firma ve yetkili kişi araması
- **Malzemeler** (`/api/materials`) — CRUD, kritik stok seviyesi filtresi, hızlı stok düzeltme (`/adjust`)
- **Stok Hareketleri & Özet** (`/api/stock`) — stok giriş/çıkış günlükleri, hareket silme (ters bakiye düzeltmeli) ve anlık KPI özetleri (`/summary`)
- **İhtiyaç Listesi** (`/api/needs-list`) — malzeme talepleri, otomatik kritik stok tespiti (`?includeAuto=true`), durum yönetimi
- **Satın Alma** (`/api/purchases`) — satın alma kayıtları, otomatik stok girişi ve ihtiyaç karşılama (atomik transaction)
- **Bakımlar** (`/api/maintenance`) — periyodik ve arızi bakımlar, kontrol listesi sonuçları, yedek parça sarfiyatı ve stok düşümü, takip numarası (`B00001`)
- **Arızalar** (`/api/faults`) — arıza bildirme, teknisyen atama, parça sarfiyatı, görsel/belge yükleme, otomatik varlık durum güncellemesi ('Arızalı' <-> 'Aktif'), takip numarası (`A00001`)
- **Muayeneler** (`/api/inspections`) — çoklu varlık kapsayan grup muayeneleri, yüklenici firma, sertifika/rapor yükleme, varlık muayene tarihi güncellemesi, takip numarası (`C00001`)
- **Dış Bakım** (`/api/ext-maintenance`) — taşeron/servis dış bakımları, çoklu varlık bağlama, servis sertifikaları, takip numarası (`D00001`)
- **Kalibrasyonlar** (`/api/calibrations`) — çoklu hassas cihaz kalibrasyonu, periyot takibi, akredite firma/laboratuvar yönetimi, sertifika yükleme, takip numarası (`K00001`)
- **Projeler** (`/api/projects`) — proje görevleri (`tasks`), tedarikçi teklifleri (`quotes`), bütçe geçmişi ve ilerleme logları, takip numarası (`P00001`)
- **Baskı & Sistem Ayarları** (`/api/settings`) — fabrika adı, logo yükleme, form yazdırma görünürlük ve kural ayarları (`print_template`)
- **Denetim İzi / Audit Logs** (`/api/audit-logs`) — kullanıcı yönetimi, stok düzeltmeleri ve kritik veri işlemlerinin kullanıcı, IP ve zaman damgasıyla denetim kaydı

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

- **Katı Yönetici Silme Yetkilendirmesi (Strict Deletion RBAC)**: Tüm modüllerdeki silme (`DELETE`) uç noktaları yetkisiz veri kaybını önlemek adına sadece `Yönetici` rolüne tahsis edilmiştir. Dış anahtar (`23503`) kısıtlamaları ve cascade/set-null ilişkileri koruma altındadır.
- **Merkezi Denetim İzi (Audit Logging)**: Kullanıcı oluşturma/silme, rol değişiklikleri, stok düzeltmeleri ve kritik kayıtlar IP adresi ve işlem detayıyla `audit_logs` tablosuna kaydedilir.
- **Güvenlik Başlıkları & Rate Limiting**: `helmet` ve `express-rate-limit` ile kaba kuvvet ve web saldırılarına karşı koruma.
- **Güvenli Dosya Yükleme**: `multer` ile MIME type / uzantı filtreleme (yalnızca JPG, PNG, WEBP, PDF) ve Path Traversal korumalı dosya silme.
- **Atomik Veritabanı İşlemleri**: Stok hareketleri, satın alma, arıza kapama sarfiyatı ve kalibrasyon işlemleri `BEGIN ... COMMIT` transaction'ları ile korunur.
- **Foreign Key İndeksleri**: Tüm dış anahtarlar indekslenerek JOIN ve kaskat silme performansları optimize edilmiştir.
- **Zarif Kapatma (Graceful Shutdown)**: `SIGINT` / `SIGTERM` sinyallerinde HTTP sunucusu ve veritabanı havuzu bağlantıları temiz şekilde kapatılır.

## Testler

Test paketi Node.js yerleşik test koşucusu (`node:test`) ve `assert/strict` kullanır. Test yardımcısı sunucunun açık olup olmadığını otomatik kontrol eder (`ensureServerRunning`):

```bash
npm test
```

Toplam **10 test dosyası**, **14 test paketi** ve **81 test senaryosu** bulunmaktadır (%100 başarı oranı).

Projenin tam mimari şeması, tüm API uç noktaları listesi, PWA ve üretim ortamı dağıtım yönergeleri için lütfen kök dizindeki [README.md](../README.md) dosyasına başvurun.
