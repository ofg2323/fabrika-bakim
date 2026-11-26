# Otomatik Proje Yedeği (Kod + Veri + Dosyalar)

Her gün proje kökündeki **`yedek/`** klasörüne, o günün tam durumunu içeren bir paket
bırakır. Paketi başka bir diske/buluta kopyaladığınızda programı ve verileri
sıfırdan yeniden oluşturabilirsiniz.

## Hızlı kullanım

| İşlem | Komut |
|---|---|
| Hemen yedek al | `yedek-al.bat` |
| Günlük otomatik yedeği kur | `yedek-kur.bat` |
| Otomatik yedeği kaldır | `yedek-kaldir.bat` |
| Elle (terminal) | `node backend/scripts/proje-yedek.js` |
| Geri yükle | `node backend/scripts/proje-geri-yukle.js yedek/<tarih>/VERI/veritabani.json.gz --yes` |

Varsayılan saat **02:00**'dır. Farklı saat için:

```powershell
powershell -ExecutionPolicy Bypass -File yedek-kur.ps1 -Time "23:30"
```

## Yedek klasörünün yapısı

```text
yedek/
  20261125-183000/
    KOD/                     # Programın tamamı (node_modules, .env, eski yedekler hariç)
    VERI/
      veritabani.json.gz     # Tüm iş verisi (varlıklar, arızalar, bakımlar, stok, kullanıcılar...)
      dosyalar.tar.gz        # backend/uploads içeriği
      ozet.json              # Tablo bazında kayıt sayıları
    YEDEK-BILGI.md           # Manifest: tarih, kaynak DB, kayıt sayıları, sha256
    YENIDEN-OLUSTUR.md       # Sıfırdan kurulum / geri yükleme talimatı
  fabrika-bakim-yedek-20261125-183000.zip
```

- Son **14** yedek tutulur (`YEDEK_SAKLAMA` ortam değişkeniyle değiştirilebilir).
- Her yedek hem klasör hem `.zip` olarak üretilir; tek dosya kopyalamak için `.zip` kullanın.
- `.env` dosyası **bilinçli olarak kopyalanmaz** (veritabanı parolası/JWT anahtarı sızmaz).
  Geri yüklemede `backend/.env.example`'dan yeni bir `.env` oluşturulur.

## Yedeği güvenceye alma

`yedek/fabrika-bakim-yedek-<tarih>.zip` dosyasını düzenli olarak:

- harici diske / NAS'a,
- kurumsal dosya sunucusuna,
- veya şifreli bir bulut klasörüne

kopyalayın. Aynı diskteki yedek, disk arızasında işe yaramaz.

## Yedekten yeniden oluşturma

1. `.zip` dosyasını istediğiniz makineye çıkarın.
2. `KOD/backend` içinde `cp .env.example .env` yapıp `DATABASE_URL` ve `JWT_SECRET` doldurun.
3. `npm ci && npm run db:migrate`
4. `node scripts/proje-geri-yukle.js ../VERI/veritabani.json.gz --yes`
5. `tar -xzf ../VERI/dosyalar.tar.gz -C uploads`
6. `npm start` → `http://localhost:3001`

Ayrıntılı ve makine tarafından okunabilir talimat her yedeğin içindeki
**`YENIDEN-OLUSTUR.md`** dosyasındadır. Bu klasörü OpenCode/Claude'a verdiğinizde
programı ve mevcut durumu bu talimatla yeniden kurabilir.

## Nasıl çalışır?

- Veritabanına doğrudan `DATABASE_URL` ile bağlanır (Neon, yerel PostgreSQL, Docker fark etmez).
- `pg_dump` veya Docker gerektirmez.
- Tüm tablolar FK sırasına göre JSON olarak dışa aktarılır; geri yükleme betiği
  şemayı `schema.sql` + migration'lardan, veriyi bu dosyadan yeniden oluşturur.
- Yedek alınırken uygulamanın çalışıyor olması sorun değildir; ancak tutarlılık için
  yoğun kullanım saatleri yerine gece çalışması önerilir.
