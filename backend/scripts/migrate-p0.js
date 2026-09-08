const pool = require('../src/db/pool');

async function migrate() {
  console.log('--- P0 Veritabanı İyileştirmeleri ve Constraint Göçü Başlatılıyor ---');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. stock_movements tablosuna doğrudan bakım ve arıza referansları ekleme
    console.log('1. stock_movements tablosuna ref_maintenance_id ve ref_fault_id ekleniyor...');
    await client.query(`
      ALTER TABLE stock_movements 
      ADD COLUMN IF NOT EXISTS ref_maintenance_id UUID REFERENCES maintenance_records(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS ref_fault_id UUID REFERENCES faults(id) ON DELETE CASCADE;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_movements_maint ON stock_movements(ref_maintenance_id);
      CREATE INDEX IF NOT EXISTS idx_stock_movements_fault ON stock_movements(ref_fault_id);
    `);

    // 2. CHECK constraint'leri ekleme (Negatif stok ve mantıksız değer koruması)
    console.log('2. Veri bütünlüğü CHECK constraintleri ekleniyor...');
    
    // Önce olası negatif stokları düzeltelim (varsa)
    await client.query(`
      UPDATE materials SET qty = 0 WHERE qty < 0;
      UPDATE materials SET min_qty = 0 WHERE min_qty < 0;
      UPDATE materials SET unit_cost = 0 WHERE unit_cost < 0;
    `);

    // materials constraint'leri
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_materials_qty_non_negative') THEN
          ALTER TABLE materials ADD CONSTRAINT chk_materials_qty_non_negative CHECK (qty >= 0);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_materials_min_qty_non_negative') THEN
          ALTER TABLE materials ADD CONSTRAINT chk_materials_min_qty_non_negative CHECK (min_qty >= 0);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_materials_unit_cost_non_negative') THEN
          ALTER TABLE materials ADD CONSTRAINT chk_materials_unit_cost_non_negative CHECK (unit_cost >= 0);
        END IF;
      END $$;
    `);

    // stock_movements constraint'i
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_stock_qty_positive') THEN
          ALTER TABLE stock_movements ADD CONSTRAINT chk_stock_qty_positive CHECK (qty > 0);
        END IF;
      END $$;
    `);

    // maintenance_used_materials constraint'i
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_maint_qty_positive') THEN
          ALTER TABLE maintenance_used_materials ADD CONSTRAINT chk_maint_qty_positive CHECK (qty > 0);
        END IF;
      END $$;
    `);

    // fault_used_materials constraint'i
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fault_qty_positive') THEN
          ALTER TABLE fault_used_materials ADD CONSTRAINT chk_fault_qty_positive CHECK (qty > 0);
        END IF;
      END $$;
    `);

    // purchases constraint'i
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_purchases_qty_positive') THEN
          ALTER TABLE purchases ADD CONSTRAINT chk_purchases_qty_positive CHECK (qty > 0);
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
    console.log('✅ P0 veritabanı göçü başarıyla tamamlandı.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Göç hatası:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
