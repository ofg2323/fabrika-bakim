-- Eski tek seferlik migrate-p*.js betiklerinin canlı veritabanına eklediği,
-- ancak schema.sql temel şemasında yer almayan değişiklikleri hizalar.
-- Amaç: yeni kurulumların (schema.sql + migration'lar) mevcut kurulumlarla
-- birebir aynı şemayı üretmesi.

-- 1) Kalibrasyon kayıtlarına oluşturma zamanı
ALTER TABLE calibration_records
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 2) Eksik indeksler
CREATE INDEX IF NOT EXISTS idx_calibration_records_group
  ON calibration_records (group_id);

CREATE INDEX IF NOT EXISTS idx_calibration_records_end_date
  ON calibration_records (end_date DESC);

CREATE INDEX IF NOT EXISTS idx_calib_rec_assets_asset
  ON calibration_record_assets (asset_id);

CREATE INDEX IF NOT EXISTS idx_calib_certs_calib_id
  ON calibration_certificates (calibration_id);

-- 3) Takip numarası zorunluluğu
-- Canlı kurulumda zaten NOT NULL. Boş değer bulunan eski bir kurulumda
-- migration'ı kilitlememek için yalnızca veri uygunsa uygulanır.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM calibration_records WHERE tracking_no IS NULL) THEN
    ALTER TABLE calibration_records ALTER COLUMN tracking_no SET NOT NULL;
  ELSE
    RAISE WARNING 'calibration_records.tracking_no içinde NULL kayıtlar var; NOT NULL kısıtı atlandı.';
  END IF;
END $$;

-- 4) Nullability ve varsayılan değer farkları
-- Yeni kurulumların canlı şemayla aynı davranması için hizalanır.
ALTER TABLE calibration_records ALTER COLUMN group_id DROP NOT NULL;
ALTER TABLE calibration_records ALTER COLUMN service_cost DROP NOT NULL;
ALTER TABLE calibration_records ALTER COLUMN service_cost TYPE NUMERIC(12,2) USING service_cost::NUMERIC(12,2);

ALTER TABLE maintenance_attachments ALTER COLUMN added_date DROP NOT NULL;
ALTER TABLE maintenance_attachments ALTER COLUMN kind SET DEFAULT 'document';

ALTER TABLE calibration_certificates ALTER COLUMN added_date DROP NOT NULL;
ALTER TABLE calibration_certificates ALTER COLUMN kind SET DEFAULT 'document';
