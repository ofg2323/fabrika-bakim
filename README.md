# 🏭 Fabrika Bakım Yönetimi (CMMS) — Tam Sürüm

Endüstriyel tesisler, üretim sahaları ve fabrikalar için geliştirilmiş; **varlık (ekipman), periyodik bakım, arıza müdahale, yasal muayene, dış servis, malzeme & yedek parça stoğu, satın alma, proje yönetimi ve maliyet takibini** tek çatı altında toplayan kurumsal ölçekli **Bilgisayarlı Bakım Yönetim Sistemi (Computerized Maintenance Management System — CMMS)**.

Uygulama; modern bir **PWA (Progressive Web App)** arayüzü, **Node.js / Express** tabanlı RESTful backend mimarisi ve **PostgreSQL** ilişkisel veritabanı ile tam entegre çalışır.

---

## 📑 İçindekiler

- [Genel Bakış ve Temel Özellikler](#-genel-bakış-ve-temel-özellikler)
- [Fonksiyonel Modüller](#-fonksiyonel-modüller)
- [Mimari ve Teknoloji Yığını](#-mimari-ve-teknoloji-yığını)
- [Proje Dizin Yapısı](#-proje-dizin-yapısı)
- [Veritabanı Mimarisi ve Veri Modeli](#-veritabanı-mimarisi-ve-veri-modeli)
- [Kurulum ve Çalıştırma](#-kurulum-ve-çalıştırma)
- [PWA (Çevrimdışı / Mobil) Kullanımı](#-pwa-çevrimdışı--mobil-kullanımı)
- [REST API Referansı](#-rest-api-referansı)
- [Güvenlik ve Performans Önlemleri](#-güvenlik-ve-performans-önlemleri)
- [Testler ve Kalite Doğrulama](#-testler-ve-kalite-doğrulama)
- [Üretim (Production) ve Dağıtım Rehberi](#-üretim-production-ve-dağıtım-rehberi)

---

## 🌟 Genel Bakış ve Temel Özellikler

- **Uçtan Uca Bakım Yönetimi**: Planlı/periyodik koruyucu bakımlar, kestirimci kontroller ve beklenmeyen arıza kayıtlarının anlık yönetimi.
- **Otomatik Sayaç & Takip Numaraları**: Tüm iş emirleri yarış durumuna (race condition) karşı korumalı PostgreSQL atomik sayaçları ile kurumsal kodlarla etiketlenir (`A00001` Arıza, `B00001` Bakım, `C00001` Muayene, `D00001` Dış Bakım, `P00001` Proje).
- **Yedek Parça ve Stok Entegrasyonu**: Bakım ve arıza müdahalelerinde harcanan parçaların otomatik stoktan düşülmesi ve maliyetlerin iş emrine yansıtılması.
- **Otomatik Kritik Stok Tespiti**: Minimum seviyenin altına düşen malzemelerin otomatik olarak ihtiyaç listesine düşmesi.
- **Satın Alma — Stok — İhtiyaç Zinciri (Atomik Transaction)**: Satın alma onaylandığında stok bakiyesinin artırılması, stok hareket günlüğünün oluşturulması ve açık talebin kapatılmasının tek bir veritabanı işlemi (`BEGIN ... COMMIT`) ile garanti altına alınması.
- **Yasal Muayene ve Taşeron Servis Takibi**: Basınçlı kaplar, kaldırma araçları vb. için periyodik kontrol döngüleri, akredite firma ve sertifika/rapor arşivleme.
- **Proje ve CAPEX Yönetimi**: Fabrika revizyon ve yatırım projeleri için alt görevler, tedarikçi teklifleri, bütçe revizyon geçmişi ve gerçekleşen harcama takibi.
- **Kurumsal İş Emri Yazdırma (Baskı Şablonu)**: Özelleştirilebilir fabrika logosu, firma başlığı ve form kuralları ile A4 formatında temiz iş emri ve bakım raporu dökümleri.
- **Progressive Web App (PWA)**: Kurulum gerektirmeden masaüstü ve mobil cihazlara doğrudan yüklenebilir (Service Worker ve Web App Manifest destekli).

---

## 🧩 Fonksiyonel Modüller

| Modül | Uç Nokta | Yetki Rolleri | Açıklama |
| :--- | :--- | :--- | :--- |
| **Kimlik Doğrulama** | `/api/auth` | Herkese Açık | JWT tabanlı oturum açma, ilk yönetici kurulumu (`/first-admin`), kullanıcı giriş listesi. |
| **Kullanıcı Yönetimi** | `/api/users` | Yönetici / Kullanıcı | `Yönetici`, `Teknisyen`, `Depo Sorumlusu` rolleri, şifre ve profil yönetimi. |
| **Varlık Grupları** | `/api/asset-groups` | Yönetici / Teknisyen | Varlık kategorizasyonu, periyot günleri, dinamik kontrol listeleri (Checklist), muayene ve dış bakım ayarları. |
| **Varlıklar (Ekipmanlar)** | `/api/assets` | Tüm Roller | Makine kartları, hiyerarşik üst/alt varlık ağacı, QR/kod takibi, ekler (resim/şema/PDF), yedek parça ilişkileri. |
| **Malzeme & Envanter** | `/api/materials` | Depo / Yönetici | Malzeme kartları, birimler, birim maliyet, kritik stok seviyesi (`min_qty`), anlık stok düzeltme (`/adjust`). |
| **Stok Hareketleri** | `/api/stock` | Depo / Yönetici | Giriş/Çıkış logları, işlem nedeni, kullanıcı izi, anlık KPI özeti (`/summary`). |
| **İhtiyaç Listesi** | `/api/needs-list` | Tüm Roller | Malzeme talepleri, `?includeAuto=true` ile kritik stokları otomatik listeleme, talep onay durumları. |
| **Satın Alma** | `/api/purchases` | Depo / Yönetici | Satın alma kayıtları, otomatik stok girişi ve ihtiyaç karşılama (Atomik Transaction). |
| **Periyodik Bakımlar** | `/api/maintenance` | Teknisyen / Yönetici | İş emirleri (`B00001`), checklist yanıtları, parça sarfiyatı ve stok düşümü, işçilik ve ek maliyet hesabı. |
| **Arıza Takip** | `/api/faults` | Tüm Roller | Hızlı arıza bildirme (`A00001`), teknisyen atama, otomatik varlık durum güncellemesi ('Arızalı' ↔ 'Aktif'), görsel/belge yükleme. |
| **Yasal Muayeneler** | `/api/inspections` | Yönetici / Teknisyen | Grup bazlı periyodik muayeneler (`C00001`), çoklu varlık bağlama, rapor/sertifika yükleme, muayene takvimi güncelleme. |
| **Dış Bakım (Taşeron)** | `/api/ext-maintenance` | Yönetici / Teknisyen | Yetkili servis ve dış bakım kayıtları (`D00001`), servis sertifikaları, maliyet ve garanti takibi. |
| **Tedarikçiler** | `/api/suppliers` | Depo / Yönetici | Firma rehberi, yetkili kişi, iletişim bilgileri, ödeme vadeleri. |
| **Projeler** | `/api/projects` | Yönetici | Yatırım/revizyon projeleri (`P00001`), alt görevler, tedarikçi teklifleri, bütçe revizyonları, ilerleme günlükleri. |
| **Baskı & Sistem Ayarları** | `/api/settings` | Yönetici | Fabrika adı, kurumsal logo yükleme, A4 form baskı görünüm ayarları. |

---

## 🛠️ Mimari ve Teknoloji Yığını

```
┌────────────────────────────────────────────────────────┐
│                   İstemci Katmanı                      │
│   fabrika-bakim.html (SPA / PWA)                       │
│   ├── api-client.js (Fetch API & JWT Token Yönetimi)   │
│   ├── cmms-sync.js  (Reaktif Veri Eşitleme & Toast)    │
│   └── sw.js + manifest.json (PWA & Çevrimdışı Önbellek)│
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP / JSON / Multipart
                           ▼
┌────────────────────────────────────────────────────────┐
│                   Backend REST API                     │
│   Node.js & Express (backend/src/server.js)            │
│   ├── Güvenlik: Helmet, Rate Limiter, CORS             │
│   ├── Kimlik & Yetki: JWT, bcryptjs, RBAC Middleware   │
│   ├── Dosya Yükleme: Multer (MIME & Traversal Korumalı)│
│   └── Modüler Rotalar: /api/*                          │
└──────────────────────────┬─────────────────────────────┘
                           │ SQL / Connection Pool (pg)
                           ▼
┌────────────────────────────────────────────────────────┐
│                  Veritabanı Katmanı                    │
│   PostgreSQL (schema.sql)                              │
│   ├── UUID v4 (pgcrypto), Foreign Key İndeksleri       │
│   ├── Atomik Sayaç Fonksiyonu (get_next_counter)       │
│   └── Transaction Yönetimi (BEGIN ... COMMIT)          │
└────────────────────────────────────────────────────────┘
```

### Frontend
- **Teknoloji**: Saf JavaScript (Vanilla ES6+), HTML5, Modern CSS3.
- **UI/UX Standartları**: CSS değişkenleri (`--primary`, `--sidebar`, vb.), Flexbox & CSS Grid, WCAG AA 4.7:1 kontrast uyumluluğu, klavye odaklanma erişilebilirliği.
- **PWA Desteği**: `manifest.json` ve `sw.js` ile bağımsız masaüstü/mobil uygulama olarak yüklenebilme.
- **Senkronizasyon**: `api-client.js` ve `cmms-sync.js` ile reaktif arayüz güncelleme ve modern Toast hata/başarı bildirimleri.

### Backend
- **Platform**: [Node.js](https://nodejs.org/) (CommonJS).
- **Framework**: Express.js, `express-async-errors`.
- **Güvenlik Kütüphaneleri**: `helmet` (CSP, başlık güvenliği), `express-rate-limit` (brute-force ve DoS engelleme), `cors`.
- **Yetkilendirme**: `jsonwebtoken` (JWT), `bcryptjs` (şifreleme).
- **Dosya İşleme**: `multer` (güvenli disk depolama, MIME tip kontrolü, 10MB sınır).

### Veritabanı
- **PostgreSQL 14+**: Tüm birincil anahtarlar için `UUID` (`gen_random_uuid()`).
- **Veri Bütünlüğü**: `CASCADE` ve `SET NULL` kural tanımları, tüm yabancı anahtarlarda (Foreign Key) arama performans indeksleri.
- **Atomik Sayaçlar**: Eşzamanlı işlemlerde çakışmayı önleyen `get_next_counter(kind)` SQL saklı yordamı.

---

## 📁 Proje Dizin Yapısı

```text
fabrika-bakim-backend/
├── api-client.js              # Tarayıcı için REST API istemci kütüphanesi (JWT ve Fetch sarmalayıcı)
├── cmms-sync.js               # Frontend UI ve backend API senkronizasyon katmanı
├── fabrika-bakim.html         # Tek sayfa uygulama (SPA) ana kullanıcı arayüzü
├── favicon.ico                # Web favicon ikonu
├── icon-192.png               # PWA 192x192 uygulama ikonu
├── icon-512.png               # PWA 512x512 yüksek çözünürlüklü uygulama ikonu
├── manifest.json              # PWA manifest dosyası
├── sw.js                      # PWA Service Worker dosyası
│
└── backend/
    ├── .env                   # Aktif ortam değişkenleri (PostgreSQL bağlantısı, JWT anahtarı)
    ├── .env.example           # Ortam değişkenleri örnek şablonu
    ├── package.json           # Node.js bağımlılıkları ve çalıştırma komutları
    ├── package-lock.json      # Kilitlenmiş bağımlılık ağacı
    │
    ├── src/
    │   ├── server.js          # Express sunucusu ana giriş noktası, middleware ve rota tanımları
    │   ├── db/
    │   │   ├── init.js        # 'npm run db:init' çalıştırıcısı (schema.sql'i uygular)
    │   │   ├── pool.js        # pg.Pool PostgreSQL bağlantı havuzu yapılandırması
    │   │   └── schema.sql     # PostgreSQL tablo tanımları, indeksler ve sayaç fonksiyonları
    │   ├── middleware/
    │   │   ├── auth.js        # JWT doğrulama (requireAuth) ve rol kontrolü (requireRole)
    │   │   └── upload.js      # Multer yapılandırması, MIME kontrolleri ve dosya silme yardımcıları
    │   ├── utils/
    │   │   ├── counters.js    # Atomik takip numarası üreticisi (A00001, B00001...)
    │   │   └── formatters.js  # DB (snake_case) <-> API (camelCase) veri dönüştürücüleri
    │   └── modules/           # Modüler iş mantığı rotaları
    │       ├── asset-groups/  # Varlık grupları ve checklist şablonları
    │       ├── assets/        # Varlık CRUD, ekler ve yedek parça ilişkileri
    │       ├── auth/          # Giriş, ilk yönetici kaydı ve genel kullanıcı listesi
    │       ├── ext-maintenance/# Taşeron dış bakım kayıtları ve sertifikaları
    │       ├── faults/        # Arıza yönetimi, parça kullanımı ve durum güncellemesi
    │       ├── inspections/   # Yasal muayene kayıtları ve sertifikaları
    │       ├── maintenance/   # Periyodik ve arızi bakım iş emirleri
    │       ├── materials/     # Malzeme ve stok kartları
    │       ├── needs-list/    # İhtiyaç listesi ve otomatik kritik stok tespiti
    │       ├── projects/      # Yatırım projeleri, görevler, teklifler ve bütçe
    │       ├── purchases/     # Satın alma işlemleri ve atomik stok artırımı
    │       ├── settings/      # Sistem ayarları, kurumsal logo ve baskı şablonu
    │       ├── stock/         # Stok giriş/çıkış günlükleri ve KPI özeti
    │       ├── suppliers/     # Tedarikçi rehberi
    │       └── users/         # Kullanıcı yönetimi ve yetkilendirme
    │
    ├── scripts/
    │   ├── setup-db.js        # Yerel PostgreSQL rol ve veritabanı otomatik kurulum betiği
    │   └── generate-icon.js   # PWA ikonlarını sıfırdan üreten yardımcı betik
    │
    ├── tests/                 # 'node:test' tabanlı entegrasyon ve birim test paketleri
    │   ├── helpers.js         # Test API istemcisi ve admin token üreticisi
    │   ├── 01_auth_users.test.js
    │   ├── 02_assets_groups.test.js
    │   ├── 03_materials_stock_purchases.test.js
    │   ├── 04_maintenance_faults.test.js
    │   ├── 05_inspections_extmaint.test.js
    │   ├── 06_projects_settings.test.js
    │   └── 07_security_static.test.js
    │
    └── uploads/               # Yüklenen görseller, sertifikalar, logolar ve PDF belgeleri
```

---

## 🗄️ Veritabanı Mimarisi ve Veri Modeli

PostgreSQL veritabanında 20'den fazla tablo ve özel işlev bulunmaktadır:

```mermaid
erDiagram
    USERS ||--o{ ASSETS : "sahip/sorumlu"
    USERS ||--o{ MAINTENANCE_RECORDS : "tamamlayan"
    USERS ||--o{ FAULTS : "bildiren / atanan"
    USERS ||--o{ STOCK_MOVEMENTS : "işlem yapan"
    USERS ||--o{ PURCHASES : "satın alan"
    USERS ||--o{ PROJECTS : "proje sorumlusu"

    ASSET_GROUPS ||--o{ ASSETS : "içerir"
    ASSET_GROUPS ||--o{ INSPECTION_RECORDS : "muayene edilir"
    ASSET_GROUPS ||--o{ EXT_MAINT_RECORDS : "dış bakım yapılır"

    ASSETS ||--o{ MAINTENANCE_RECORDS : "bakım geçmişi"
    ASSETS ||--o{ FAULTS : "arıza geçmişi"
    ASSETS ||--o{ ASSET_ATTACHMENTS : "ekler"
    ASSETS }|--|{ MATERIALS : "yedek parçalar"

    SUPPLIERS ||--o{ MATERIALS : "varsayılan tedarikçi"
    SUPPLIERS ||--o{ PURCHASES : "tedarikçi"
    SUPPLIERS ||--o{ PROJECT_QUOTES : "teklif veren"

    MATERIALS ||--o{ STOCK_MOVEMENTS : "hareketler"
    MATERIALS ||--o{ PURCHASES : "satın alımlar"
    MATERIALS ||--o{ MAINTENANCE_USED_MATERIALS : "sarfiyat"
    MATERIALS ||--o{ FAULT_USED_MATERIALS : "sarfiyat"

    PROJECTS ||--o{ PROJECT_TASKS : "görevler"
    PROJECTS ||--o{ PROJECT_QUOTES : "teklifler"
    PROJECTS ||--o{ PROJECT_BUDGET_HISTORY : "bütçe geçmişi"
    PROJECTS ||--o{ PURCHASES : "proje harcamaları"
```

### Özel Veritabanı Nitelikleri
1. **Atomik Sayaç Sistemi**:
   ```sql
   CREATE OR REPLACE FUNCTION get_next_counter(kind_input TEXT)
   RETURNS INT AS $$
     UPDATE counters SET value = value + 1 WHERE kind = kind_input RETURNING value;
   $$ LANGUAGE sql;
   ```
   Bu mekanizma sayesinde bakım (`B00001`), arıza (`A00001`), muayene (`C00001`), dış bakım (`D00001`) ve proje (`P00001`) kodları eşzamanlı isteklerde dahi mükerrerlik olmadan ardışık üretilir.

2. **Atomik Satın Alma ve Stok Entegrasyonu**:
   Bir satın alma kaydedildiğinde (`POST /api/purchases`), `purchases` tablosuna kayıt atılır, `stock_movements` tablosuna `Giriş` kaydı eklenir, `materials.qty` güncellenir ve eğer bir ihtiyaç talebine bağlıysa `needs_list.status` değeri `Alındı` olarak işaretlenir. Herhangi bir adımda hata olursa tüm işlem geri alınır (`ROLLBACK`).

3. **Otomatik Varlık Durum Tetikleyicisi**:
   Bir varlıkta arıza açıldığında (`POST /api/faults`) varlık durumu otomatik olarak `Arızalı` yapılır. Arıza çözüldüğünde (`status = 'Tamamlandı'`) varlık durumu otomatik olarak tekrar `Aktif` statüsüne döner.

---

## 🚀 Kurulum ve Çalıştırma

### 1. Ön Gereksinimler
- [Node.js](https://nodejs.org/) v18.0.0 veya üzeri
- [PostgreSQL](https://www.postgresql.org/) v14.0 veya üzeri (veya Neon / Supabase / Railway gibi bir bulut PostgreSQL)

### 2. Bağımlılıkların Yüklenmesi
Konsolda `backend` dizinine gidin:
```bash
cd backend
npm install
```

### 3. Ortam Değişkenlerinin Yapılandırılması
`.env.example` dosyasını kopyalayarak `.env` dosyasını oluşturun:
```bash
cp .env.example .env
```
`.env` dosyasını açıp kendi bağlantı parametrelerinizi girin:
```ini
# PostgreSQL Veritabanı Bağlantı Adresi
DATABASE_URL=postgres://fabrika_user:sifre@localhost:5432/fabrika_bakim

# JWT Oturum İmzalama Anahtarı (Üretimde uzun ve rastgele bir anahtar kullanın)
JWT_SECRET=guvenli-ve-cok-gizli-rastgele-anahtar-dizgesi-2026

# Sunucu Portu
PORT=3001

# Yüklenen Dosyaların Tutulacağı Klasör
UPLOAD_DIR=./uploads

# (Opsiyonel) İzin verilen CORS adresleri (virgülle ayırarak)
# CORS_ORIGIN=http://localhost:3000,http://127.0.0.1:5500
```

### 4. Veritabanının Hazırlanması
Yerel PostgreSQL kullanıyorsanız ve otomatik rol/veritabanı oluşturmak isterseniz:
```bash
node scripts/setup-db.js
```
Ardından şemayı veritabanına uygulayın:
```bash
npm run db:init
```
> [!NOTE]
> `npm run db:init` komutu `src/db/schema.sql` dosyasını çalıştırarak tüm tabloları, sayaçları ve indeksleri eksiksiz oluşturur.

### 5. Sunucuyu Başlatma
- **Geliştirme Modunda (Otomatik Yeniden Başlatma)**:
  ```bash
  npm run dev
  ```
- **Üretim Modunda**:
  ```bash
  npm start
  ```
Sunucu başladığında şu çıktıyı görürsünüz:
```text
Fabrika Bakım API çalışıyor: http://localhost:3001
```

### 6. İlk Yönetici (Admin) Hesabının Oluşturulması
Uygulamayı ilk kez kurduğunuzda veritabanında henüz bir kullanıcı bulunmaz. İlk yöneticiyi oluşturmak için:
- **Tarayıcı Üzerinden**: `http://localhost:3001` adresini açtığınızda sistem otomatik olarak "İlk Yönetici Kurulumu" ekranına yönlendirir.
- **veya cURL ile**:
  ```bash
  curl -X POST http://localhost:3001/api/auth/first-admin \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"Ahmet Yılmaz\", \"password\": \"GucluSifre123!\"}"
  ```

---

## 📱 PWA (Çevrimdışı / Mobil) Kullanımı

Uygulama tam teşekküllü bir **Progressive Web App**'tir:
1. **Masaüstünde (Chrome / Edge)**: Adres çubuğunun sağında beliren **"Yükle" (Install)** simgesine tıklayarak uygulamayı masaüstünüze bağımsız pencere olarak kurabilirsiniz.
2. **Mobilde (Android / iOS)**:
   - **Android Chrome**: Menüden **"Ana ekrana ekle"** seçeneğini kullanın.
   - **iOS Safari**: Paylaş butonuna basıp **"Ana Ekrana Ekle"** seçeneğini seçin.
3. **Önbellek ve Service Worker**: `sw.js` arka planda statik dosyaları önbelleğe alarak anında açılış hızı sağlar; API isteklerini ise her zaman canlı sunucuya iletir.

---

## 📡 REST API Referansı

Tüm korumalı uç noktalarda HTTP başlığı olarak `Authorization: Bearer <TOKEN>` gönderilmelidir.

### 1. Kimlik Doğrulama (`/api/auth`)
- `POST /api/auth/login`: `{ userId, password }` ile giriş yapar, JWT token döner.
- `POST /api/auth/first-admin`: Yalnızca sistemde hiç kullanıcı yokken ilk yöneticiyi kaydeder.
- `GET /api/auth/users`: Giriş ekranında gösterilmek üzere kullanıcı listesi (şifresiz) döner.

### 2. Kullanıcılar (`/api/users`)
- `GET /api/users`: Tüm kullanıcıları listeler.
- `POST /api/users` *(Yönetici)*: Yeni kullanıcı oluşturur (`name`, `role`, `password`).
- `PUT /api/users/:id`: Kullanıcı bilgisi veya şifresini günceller.
- `DELETE /api/users/:id` *(Yönetici)*: Kullanıcıyı siler (kendi hesabını silemez).

### 3. Varlık Grupları (`/api/asset-groups`)
- `GET /api/asset-groups`: Grupları ve bakım periyotlarını listeler.
- `POST /api/asset-groups`: Yeni grup ve checklist şablonu tanımlar.
- `PUT /api/asset-groups/:id`: Grubu ve checklist sorularını günceller.
- `DELETE /api/asset-groups/:id`: Grubu siler.

### 4. Varlıklar / Makineler (`/api/assets`)
- `GET /api/assets`: Varlıkları listeler (filtreler: `groupId`, `status`, `search`).
- `GET /api/assets/:id`: Varlık detayını, bağlı yedek parçalarını ve eklerini döner.
- `POST /api/assets`: Yeni varlık kartı oluşturur.
- `PUT /api/assets/:id`: Varlık kartını günceller.
- `DELETE /api/assets/:id`: Varlığı siler.
- `POST /api/assets/:id/attachments`: Varlığa resim veya teknik PDF ekler (Multipart).
- `DELETE /api/assets/:id/attachments/:attId`: Ekli dosyayı ve veritabanı kaydını siler.
- `PUT /api/assets/:id/spare-parts`: Varlığa yedek parça listesi atar.
- `GET /api/assets/:id/history`: Varlığın geçmiş bakım, arıza, muayene kayıtlarını ve toplam maliyetini döner.

### 5. Malzemeler ve Stok (`/api/materials` & `/api/stock`)
- `GET /api/materials`: Stok kartlarını listeler (`?lowStock=true` ile kritik stok filtresi).
- `POST /api/materials`: Yeni malzeme kartı tanımlar.
- `PUT /api/materials/:id`: Malzeme bilgilerini günceller.
- `POST /api/materials/:id/adjust`: Hızlı stok düzeltmesi yapar ve hareket günlüğü oluşturur.
- `GET /api/stock`: Stok giriş/çıkış hareketlerini listeler.
- `GET /api/stock/summary`: Toplam malzeme sayısı, kritik stok adedi ve toplam envanter maliyetini döner.

### 6. İhtiyaç Listesi (`/api/needs-list`)
- `GET /api/needs-list`: Talepleri listeler (`?includeAuto=true` kritik stokları da sanal talep olarak döner).
- `POST /api/needs-list`: Manuel malzeme talebi oluşturur.
- `PUT /api/needs-list/:id`: Talep durumunu (`Beklemede`, `Sipariş Verildi`, `Alındı`) günceller.
- `DELETE /api/needs-list/:id`: Talep kaydını siler.

### 7. Satın Alma (`/api/purchases`)
- `GET /api/purchases`: Satın alma geçmişini listeler.
- `POST /api/purchases`: Yeni alım kaydeder; **stoku otomatik artırır** ve talebi karşılar.
- `DELETE /api/purchases/:id` *(Yönetici)*: Alımı siler ve stoku eski haline düşer.

### 8. Bakım Kayıtları (`/api/maintenance`)
- `GET /api/maintenance`: Bakımları listeler (`assetId`, `groupId`, `type`, `startDate`, `endDate`, `q`).
- `GET /api/maintenance/:id`: Bakım detayını, kontrol listesi sonuçlarını ve kullanılan parçaları döner.
- `POST /api/maintenance`: Yeni bakım kaydeder (`Bxxxxx`), kullanılan parçaları **stoktan düşer** ve makinenin son bakım tarihini günceller.
- `PUT /api/maintenance/:id`: Bakım kaydını günceller.
- `DELETE /api/maintenance/:id`: Bakım kaydını siler.

### 9. Arıza Kayıtları (`/api/faults`)
- `GET /api/faults`: Arıza kayıtlarını listeler (`status`, `priority`, `assetId`, `q`).
- `GET /api/faults/:id`: Arıza detayını, kullanılan parçaları ve fotoğrafları döner.
- `POST /api/faults`: Arıza kaydı açar (`Axxxxx`), makineyi **'Arızalı'** yapar.
- `PUT /api/faults/:id`: Arıza durumunu günceller; tamamlandığında makineyi **'Aktif'** yapar ve parçaları stoktan düşer.
- `POST /api/faults/:id/attachments`: Arıza fotoğrafı/raporu yükler.
- `DELETE /api/faults/:id`: Arıza kaydını siler.

### 10. Muayene ve Dış Bakım (`/api/inspections` & `/api/ext-maintenance`)
- `GET /api/inspections` / `GET /api/ext-maintenance`: Kayıtları listeler.
- `POST /api/inspections` / `POST /api/ext-maintenance`: Yeni kayıt açar (`Cxxxxx` / `Dxxxxx`), gruptaki tüm varlıkların yasal/servis tarihlerini günceller.
- `POST /api/inspections/:id/certificates`: Muayene raporu/sertifikası yükler.
- `POST /api/ext-maintenance/:id/certificates`: Servis formu/fatura yükler.

### 11. Projeler (`/api/projects`)
- `GET /api/projects`: Projeleri ve bütçe/harcama oranlarını listeler.
- `POST /api/projects`: Yeni proje tanımlar (`Pxxxxx`).
- `POST /api/projects/:id/tasks`: Projeye görev ekler.
- `POST /api/projects/:id/quotes`: Projeye tedarikçi teklifi ve dosya ekler.
- `POST /api/projects/:id/budget-history`: Bütçe revizyon kaydı ekler.
- `POST /api/projects/:id/progress-logs`: İlerleme notu düşer.

### 12. Sistem ve Baskı Ayarları (`/api/settings`)
- `GET /api/settings`: Şirket adı, logo ve yazdırma kurallarını döner.
- `PUT /api/settings`: Ayarları günceller.
- `POST /api/settings/logo`: Kurumsal logo görseli yükler.

---

## 🔒 Güvenlik ve Performans Önlemleri

- **Helmet Güvenlik Başlıkları**: X-Content-Type-Options, Strict-Transport-Security ve özel Content-Security-Policy (CSP) direktifleri uygulanmıştır.
- **Hız Sınırlama (Rate Limiting)**:
  - Genel API için 15 dakikada en fazla 300 istek (üretim modu).
  - Giriş uç noktaları (`/api/auth/login`, `/api/auth/first-admin`) için 15 dakikada en fazla 20 deneme (kaba kuvvet koruması).
- **Zararlı Dosya Koruması**:
  - Yalnızca geçerli resim (`image/jpeg`, `image/png`, `image/webp`) ve belgeler (`application/pdf`) kabul edilir. `.exe`, `.sh`, `.php` gibi çalıştırılabilir dosyalar reddedilir.
  - Path Traversal ataklarına karşı `path.basename` ve `path.resolve` koruması uygulanmıştır.
- **SQL Injection Engelleme**: Tüm veritabanı sorguları parametrik (`$1`, `$2`...) `pg.Pool` mekanizması ile çalıştırılır.
- **Zarif Kapatma (Graceful Shutdown)**: `SIGTERM` ve `SIGINT` sinyalleri yakalanarak açık HTTP istekleri ve veritabanı havuzu bağlantıları veri kaybı olmadan temiz bir şekilde kapatılır.

---

## 🧪 Testler ve Kalite Doğrulama

Backend, harici bir test kütüphanesine ihtiyaç duymadan Node.js yerleşik test koşucusu (`node:test`) ve `assert/strict` ile kapsamlı şekilde test edilmiştir.

### Testleri Çalıştırma:
1. **1. Terminalde** sunucuyu başlatın:
   ```bash
   cd backend
   npm start
   ```
2. **2. Terminalde** testleri çalıştırın:
   ```bash
   cd backend
   npm test
   ```

### Test Kapsamı (7 Test Paketi):
1. `01_auth_users.test.js`: Giriş, JWT imzalama, yetkisiz erişim kontrolü, kullanıcı CRUD işlemleri.
2. `02_assets_groups.test.js`: Varlık grupları, makine kartları, dosya ekleri, yedek parça ilişkileri.
3. `03_materials_stock_purchases.test.js`: Stok kartları, kritik stok tespiti, atomik satın alma ve stok hareketi.
4. `04_maintenance_faults.test.js`: Bakım kaydı, arıza bildirme, otomatik 'Arızalı' durumu ve parça sarfiyatı.
5. `05_inspections_extmaint.test.js`: Çoklu varlık muayeneleri, dış bakım ve sertifika yönetimi.
6. `06_projects_settings.test.js`: Proje görevleri, teklif yükleme, bütçe revizyonu ve sistem ayarları.
7. `07_security_static.test.js`: PWA manifest/sw doğrulaması, Helmet başlıkları ve zararlı dosya yükleme engelleme testi.

---

## 🌐 Üretim (Production) ve Dağıtım Rehberi

### 1. PM2 ile Süreç Yönetimi
Uygulamanın sunucuda arka planda kesintisiz çalışması ve çökmelerde otomatik yeniden başlaması için [PM2](https://pm2.keymetrics.io/) önerilir:
```bash
npm install -g pm2
cd backend
pm2 start src/server.js --name "fabrika-bakim"
pm2 save
pm2 startup
```

### 2. Nginx Ters Vekil (Reverse Proxy) Yapılandırması
Örnek `/etc/nginx/sites-available/fabrika-bakim` dosyası:
```nginx
server {
    listen 80;
    server_name bakim.fabrikaniz.com;

    client_max_body_size 15M;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
SSL sertifikası için:
```bash
sudo certbot --nginx -d bakim.fabrikaniz.com
```

### 3. Otomatik PostgreSQL Yedekleme (Cron Job)
Veritabanınızı her gece otomatik yedeklemek için `crontab -e`:
```bash
0 3 * * * pg_dump -U fabrika_user -h localhost fabrika_bakim | gzip > /var/backups/cmms_$(date +\%F).sql.gz
```

---

## 📄 Lisans

Bu proje kurum içi endüstriyel kullanım amacıyla geliştirilmiştir. Tüm hakları saklıdır.
