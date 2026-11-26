# Veritabanı Migration'ları

Şemanın tek başlangıç noktası `../schema.sql` dosyasıdır ve **0001_initial** olarak kaydedilir.
Sonraki tüm değişiklikler bu klasöre numaralı bir `.sql` dosyası olarak eklenir.

## Yeni migration ekleme

1. Sıradaki numarayı kullanın (mevcut en yüksek numara + 1):

   ```text
   0002_work_orders.sql
   0003_user_notification_fields.sql
   ```

2. Dosya **yalnızca bir kez** uygulanır. Uygulandıktan sonra içeriğini değiştirmeyin;
   checksum doğrulaması hata verir. Düzeltme gerekiyorsa yeni bir migration ekleyin.

3. Her dosya tek bir transaction içinde çalışır. `CREATE INDEX CONCURRENTLY`,
   `VACUUM`, `CREATE DATABASE` gibi transaction dışında çalışması gereken ifadeler kullanmayın.

4. Uygulamadan önce mevcut veritabanının yedeğini alın:

   ```bash
   npm run db:backup
   npm run db:migrate
   ```

## Komutlar

```bash
npm run db:migrate            # bekleyenleri uygula
npm run db:status             # durumu göster (migration uygulamaz)
npm run db:migrate -- --strict  # şema/dosya değişikliğinde hata ver
```

## Notlar

- `0001_initial` sanaldır; dosyası yoktur, `schema.sql` ile temsil edilir.
- Test veritabanı her `npm test` çalışmasında otomatik olarak oluşturulur ve migration'lar uygulanır.
- Eski `scripts/migrate-p0.js` … `migrate-p4.js` dosyaları tarihsel kayıttır; yeni kurulumlarda
  kullanılmaz. Yeni değişiklikler için bu klasörü kullanın.
