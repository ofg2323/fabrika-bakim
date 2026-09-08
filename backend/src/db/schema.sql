-- Fabrika Bakım Yönetimi — Veritabanı Şeması (PostgreSQL)
-- Mevcut tek-dosya uygulamadaki `db` nesnesinden birebir türetilmiştir.

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid() için

-- ================= KULLANICILAR =================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Yönetici','Teknisyen','Depo Sorumlusu')),
  password_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ================= TAKİP NUMARASI SAYAÇLARI =================
-- kind: 'fault'(A) | 'maint'(B) | 'inspection'(C) | 'extmaint'(D) | 'project'(P)
CREATE TABLE counters (
  kind TEXT PRIMARY KEY,
  value INT NOT NULL DEFAULT 0
);
INSERT INTO counters(kind,value) VALUES ('fault',0),('maint',0),('inspection',0),('extmaint',0),('project',0);

-- ================= TEDARİKÇİLER =================
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  payment_terms TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ================= VARLIK GRUPLARI =================
CREATE TABLE asset_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  period_days INT NOT NULL DEFAULT 30,
  checklist JSONB NOT NULL DEFAULT '[]', -- [{id,text}]
  inspection_enabled BOOLEAN NOT NULL DEFAULT false,
  inspection_period_days INT,
  inspection_baseline_date DATE,
  ext_maint_enabled BOOLEAN NOT NULL DEFAULT false,
  ext_maint_period_days INT,
  ext_maint_baseline_date DATE
);

-- ================= VARLIKLAR =================
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  asset_code TEXT UNIQUE,
  serial TEXT,
  brand TEXT,
  model TEXT,
  capacity TEXT,
  description TEXT,
  group_id UUID REFERENCES asset_groups(id) ON DELETE SET NULL,
  parent_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif','Arızalı','Pasif')),
  last_maintenance_date DATE,
  last_inspection_date DATE,
  last_ext_maint_date DATE,
  created_date DATE NOT NULL DEFAULT CURRENT_DATE
);
CREATE INDEX idx_assets_group ON assets(group_id);
CREATE INDEX idx_assets_parent ON assets(parent_id);

CREATE TABLE asset_spare_parts (
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
  material_id UUID, -- FK eklenir (materials tablosu altta), döngüsel sıra için sonradan bağlanabilir
  PRIMARY KEY (asset_id, material_id)
);

CREATE TABLE asset_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','dosya','link')),
  storage_key TEXT,   -- dosya sisteminde/S3'te yol (image/dosya için)
  url TEXT,           -- link tipi için
  added_date DATE NOT NULL DEFAULT CURRENT_DATE
);

-- ================= MALZEMELER / STOK =================
CREATE TABLE materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'adet',
  qty NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (qty >= 0),
  min_qty NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  default_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL
);
ALTER TABLE asset_spare_parts ADD CONSTRAINT fk_spare_material FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE;

CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('Giriş','Çıkış')),
  qty NUMERIC(14,2) NOT NULL CHECK (qty > 0),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  user_id UUID REFERENCES users(id),
  reason TEXT,
  ref_purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  ref_maintenance_id UUID, -- maintenance_records oluştuktan sonra FK eklenebilir veya circular olmaması için serbest
  ref_fault_id UUID
);

CREATE TABLE needs_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID REFERENCES materials(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  qty NUMERIC(14,2) NOT NULL DEFAULT 1,
  estimated_price NUMERIC(14,2) DEFAULT 0,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'Beklemede' CHECK (status IN ('Beklemede','Sipariş Verildi','Alındı')),
  requested_by UUID REFERENCES users(id),
  requested_date DATE NOT NULL DEFAULT CURRENT_DATE
);

-- ================= PROJELER (satın almalardan önce tanımlı olmalı: FK için) =================
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_no TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  owner_user_id UUID REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'Orta' CHECK (priority IN ('Düşük','Orta','Yüksek')),
  status TEXT NOT NULL DEFAULT 'Planlama' CHECK (status IN ('Planlama','Onaylandı','Devam Ediyor','Tamamlandı','İptal')),
  start_date DATE,
  target_end_date DATE,
  actual_end_date DATE,
  budget_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_date DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE project_budget_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(14,2) NOT NULL,
  note TEXT,
  user_id UUID REFERENCES users(id)
);

CREATE TABLE project_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  status TEXT NOT NULL DEFAULT 'Beklemede' CHECK (status IN ('Beklemede','Kabul Edildi','Reddedildi')),
  file_storage_key TEXT,
  file_name TEXT,
  note TEXT
);

CREATE TABLE project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assign_type TEXT NOT NULL DEFAULT 'İç' CHECK (assign_type IN ('İç','Taşeron')),
  assignee TEXT,
  status TEXT NOT NULL DEFAULT 'Bekliyor' CHECK (status IN ('Bekliyor','Devam Ediyor','Tamamlandı')),
  cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  start_date DATE,
  end_date DATE,
  note TEXT
);

CREATE TABLE project_progress_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT NOT NULL,
  user_id UUID REFERENCES users(id)
);

-- ================= SATIN ALMA =================
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES materials(id),
  qty NUMERIC(14,2) NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  total_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_price >= 0),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_text TEXT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  buyer_id UUID REFERENCES users(id),
  note TEXT
);

-- ================= BAKIMLAR =================
CREATE TABLE maintenance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_no TEXT UNIQUE,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  due_date DATE,
  type TEXT NOT NULL DEFAULT 'Periyodik' CHECK (type IN ('Periyodik','Arıza Sonrası','Kestirimci','Genel/Diğer')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  completed_by UUID REFERENCES users(id),
  checklist_results JSONB NOT NULL DEFAULT '[]', -- [{questionId,text,result}]
  notes TEXT,
  extra_cost NUMERIC(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_maint_asset ON maintenance_records(asset_id);

CREATE TABLE maintenance_used_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES maintenance_records(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id),
  qty NUMERIC(14,2) NOT NULL CHECK (qty > 0),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0)
);

-- ================= ARIZALAR =================
CREATE TABLE faults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_no TEXT UNIQUE,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  reported_by UUID REFERENCES users(id),
  reported_date DATE NOT NULL DEFAULT CURRENT_DATE,
  priority TEXT NOT NULL DEFAULT 'Orta' CHECK (priority IN ('Düşük','Orta','Yüksek')),
  status TEXT NOT NULL DEFAULT 'Açık' CHECK (status IN ('Açık','Devam Ediyor','Tamamlandı')),
  assigned_to UUID REFERENCES users(id),
  resolved_date DATE,
  notes TEXT,
  external_service_cost NUMERIC(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_faults_asset ON faults(asset_id);

CREATE TABLE fault_used_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fault_id UUID NOT NULL REFERENCES faults(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES materials(id),
  qty NUMERIC(14,2) NOT NULL CHECK (qty > 0),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0)
);

CREATE TABLE fault_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fault_id UUID NOT NULL REFERENCES faults(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','dosya','link')),
  storage_key TEXT,
  url TEXT,
  added_date DATE NOT NULL DEFAULT CURRENT_DATE
);

-- ================= MUAYENE / DIŞ BAKIM (grup bazlı, çoklu varlık kapsar) =================
CREATE TABLE inspection_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_no TEXT UNIQUE,
  group_id UUID NOT NULL REFERENCES asset_groups(id),
  contractor TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  notes TEXT,
  service_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  completed_by UUID REFERENCES users(id)
);
CREATE TABLE inspection_record_assets (
  record_id UUID REFERENCES inspection_records(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY (record_id, asset_id)
);
CREATE TABLE inspection_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES inspection_records(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','dosya','link')),
  storage_key TEXT,
  url TEXT,
  added_date DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE ext_maint_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_no TEXT UNIQUE,
  group_id UUID NOT NULL REFERENCES asset_groups(id),
  contractor TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  notes TEXT,
  service_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  completed_by UUID REFERENCES users(id)
);
CREATE TABLE ext_maint_record_assets (
  record_id UUID REFERENCES ext_maint_records(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY (record_id, asset_id)
);
CREATE TABLE ext_maint_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES ext_maint_records(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','dosya','link')),
  storage_key TEXT,
  url TEXT,
  added_date DATE NOT NULL DEFAULT CURRENT_DATE
);

-- ================= BASKI ŞABLONU / AYARLAR (tek satırlık config) =================
CREATE TABLE print_template (
  id INT PRIMARY KEY DEFAULT 1,
  company_name TEXT DEFAULT 'Fabrika Adı',
  logo_storage_key TEXT,
  footer_note TEXT,
  page_size TEXT DEFAULT 'A4',
  orientation TEXT DEFAULT 'portrait',
  maint_settings JSONB DEFAULT '{}',
  fault_settings JSONB DEFAULT '{}',
  CHECK (id = 1)
);
INSERT INTO print_template (id) VALUES (1);

-- ================= DIŞ ANAHTAR (FOREIGN KEY) İNDEKSLERİ =================
-- Silme/güncelleme kaskatları ve birleştirme (JOIN) performansı için
CREATE INDEX IF NOT EXISTS idx_materials_supplier ON materials(default_supplier_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_mat ON stock_movements(material_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_user ON stock_movements(user_id);
CREATE INDEX IF NOT EXISTS idx_needs_mat ON needs_list(material_id);
CREATE INDEX IF NOT EXISTS idx_needs_supplier ON needs_list(supplier_id);
CREATE INDEX IF NOT EXISTS idx_needs_user ON needs_list(requested_by);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_project_budget_proj ON project_budget_history(project_id);
CREATE INDEX IF NOT EXISTS idx_project_quotes_proj ON project_quotes(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_proj ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_progress_proj ON project_progress_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_purchases_mat ON purchases(material_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_proj ON purchases(project_id);
CREATE INDEX IF NOT EXISTS idx_maint_used_rec ON maintenance_used_materials(record_id);
CREATE INDEX IF NOT EXISTS idx_maint_used_mat ON maintenance_used_materials(material_id);
CREATE INDEX IF NOT EXISTS idx_fault_used_fault ON fault_used_materials(fault_id);
CREATE INDEX IF NOT EXISTS idx_fault_used_mat ON fault_used_materials(material_id);
CREATE INDEX IF NOT EXISTS idx_fault_att_fault ON fault_attachments(fault_id);
CREATE INDEX IF NOT EXISTS idx_insp_rec_grp ON inspection_records(group_id);
CREATE INDEX IF NOT EXISTS idx_insp_cert_rec ON inspection_certificates(record_id);
CREATE INDEX IF NOT EXISTS idx_ext_rec_grp ON ext_maint_records(group_id);
CREATE INDEX IF NOT EXISTS idx_ext_cert_rec ON ext_maint_certificates(record_id);

-- ================= ATOMİK SAYAÇ FONKSİYONU =================
-- Yarış durumunu (Race condition) engelleyerek sıradaki takip numarasını üretir
CREATE OR REPLACE FUNCTION get_next_counter(kind_input TEXT)
RETURNS INT AS $$
  UPDATE counters
  SET value = value + 1
  WHERE kind = kind_input
  RETURNING value;
$$ LANGUAGE sql;
