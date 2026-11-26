# Kurulum, Yedekleme ve Bakım

Bu belge üretim kurulumu, şema güncellemeleri ve yedekleme süreçlerini kapsar.

## 1. Docker ile kurulum (önerilen)

Gereksinim: Docker Engine + Docker Compose v2.

```bash
cp .env.docker.example .env
# .env içinde POSTGRES_PASSWORD ve JWT_SECRET değerlerini değiştirin
docker compose up -d --build
```

- Uygulama: `http://<sunucu>:3001`
- Başka bir makineden / IP üzerinden erişecekseniz `.env` içinde
  `CORS_ORIGIN=http://<sunucu>:3001` olarak güncelleyin; aksi hâlde tarayıcı istekleri engellenir.
- İlk açılışta boş veritabanına `schema.sql` uygulanır ve `schema_migrations` tablosu oluşturulur.
- API konteyneri her başlangıçta bekleyen migration'ları uygular.
- Veritabanı `pgdata`, yüklenen dosyalar `uploads` adlı Docker volume'ünde tutulur.

### Alan adı / HTTPS

Varsayılan kurulum HTTP üzerinden çalışır. Üretimde önüne bir reverse proxy (Nginx, Caddy,
Traefik) koyun ve TLS sonlandırın. Proxy kullanırken:

```env
CORS_ORIGIN=https://bakim.firmaniz.com
TRUST_PROXY=1
```

`CORS_ORIGIN` yanlış/boş kalırsa üretim modunda tarayıcı istekleri engellenir.

### Güncelleme

```bash
npm run db:backup          # önce yedek
git pull                    # veya yeni sürüm dosyalarını kopyalayın
docker compose up -d --build
```

`docker compose up` sırasında API başlarken `src/db/migrate.js` bekleyen migration'ları uygular.

## 2. Şema değişiklikleri (migration)

Tek kural: **uygulanmış bir dosyayı değiştirmeyin**, yeni dosya ekleyin.

```text
backend/src/db/migrations/0002_work_orders.sql
backend/src/db/migrations/0003_user_notification_fields.sql
```

```bash
npm run db:status            # durum
npm run db:migrate           # bekleyenleri uygula
npm run db:migrate -- --strict
```

- Her dosya tek transaction içinde çalışır.
- Uygulanan dosyanın checksum'ı saklanır; sonradan değiştirilirse hata verilir.
- `0001_initial` sanaldır ve `schema.sql` ile temsil edilir.
- Ayrıntılar: `backend/src/db/migrations/README.md`.

## 3. Yedekleme ve geri yükleme

### Yedek alma

```bash
npm run db:backup
```

`backups/` altına iki dosya yazar:

- `fabrika-db-YYYYMMDD-HHmmss.dump` — PostgreSQL custom format (`pg_dump -Fc`)
- `fabrika-uploads-YYYYMMDD-HHmmss.tar.gz` — yüklenen belgeler/görseller

`RETENTION_DAYS` (varsayılan 30) günden eski yedekler otomatik silinir.

### Geri yükleme

```bash
npm run db:restore -- backups/fabrika-db-20260101-120000.dump --yes
# dosyalar da geri yüklenecekse:
npm run db:restore -- backups/....dump --yes --uploads backups/fabrika-uploads-....tar.gz
```

Komut API'yi durdurur, veritabanını `--clean --if-exists` ile yeniden oluşturur ve API'yi başlatır.
`--yes` olmadan çalışmaz.

### Otomatik yedek

Linux (cron, her gün 02:00):

```cron
0 2 * * * cd /opt/fabrika-bakim/backend && /usr/bin/node scripts/db-backup.js >> /var/log/fabrika-backup.log 2>&1
```

Windows (Görev Zamanlayıcı):

```powershell
# Eylem: Program/script
C:\Program Files\nodejs\node.exe
# Bağımsız değişkenler
scripts\db-backup.js
# Başlangıç dizini
C:\...\fabrika-bakim\backend
```

> Yedekleri sunucu dışına (NAS, S3, başka disk) kopyalamak zorunludur. Aynı diskteki yedek
> felaket senaryosunda işe yaramaz.

### Docker olmadan (yerel PostgreSQL)

`db:backup` Docker'a bağlıdır. Docker kullanmıyorsanız:

```bash
pg_dump "$DATABASE_URL" -Fc -f backups/fabrika-$(date +%Y%m%d-%H%M%S).dump
```

## 4. Testler

Testler yıkıcıdır (kayıt siler, sayaç sıfırlar). Bu yüzden izole bir veritabanında çalışır:

```bash
cd backend
npm test
```

Bu komut:

1. `DATABASE_URL`'deki veritabanı adına `_test` ekler (ör. `fabrika_bakim_test`).
2. Veritabanı yoksa oluşturur ve migration'ları uygular.
3. Testleri `NODE_ENV=test`, `PORT=3101` ile çalıştırır.

Farklı bir test veritabanı için:

```bash
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/ozel_test npm test
```

`tests/helpers.js`, adı `_test` ile bitmeyen bir veritabanına bağlanmayı reddeder
(`ALLOW_DESTRUCTIVE_TESTS=1` ile bilinçli olarak aşılabilir).

Veritabanı kullanıcısının `CREATEDB` yetkisi yoksa test veritabanını elle oluşturun ve
`TEST_DATABASE_URL` tanımlayın.

## 5. Üretim kontrol listesi

- [ ] `JWT_SECRET` en az 32 karakter, rastgele ve yalnızca bu kuruluma özel.
- [ ] `POSTGRES_PASSWORD` güçlü; veritabanı portu dışarıya açık değil.
- [ ] `CORS_ORIGIN` gerçek adres; `TRUST_PROXY` proxy arkasında `1`.
- [ ] HTTPS (reverse proxy) ve düzenli sertifika yenileme.
- [ ] Günlük otomatik yedek + sunucu dışı kopya + geri yükleme testi.
- [ ] `uploads` volume'ü yedek kapsamında.
- [ ] İlk yönetici hesabı oluşturuldu, demo/varsayılan kullanıcılar silindi.
- [ ] `docker compose logs -f api` izleniyor; disk doluluk uyarısı kurulu.
