const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const pool = require('./db/pool');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'degistirin-lutfen-uzun-rastgele-bir-anahtar') {
  console.warn('UYARI: JWT_SECRET ortam değişkeni güvenli ve rastgele bir anahtarla ayarlanmalıdır.');
}

const app = express();

// Reverse proxy desteği (Cloudflare Tunnel, Nginx, Docker vb. arkasında gerçek IP tespiti ve rate-limit uyumluluğu)
const trustProxySetting = process.env.TRUST_PROXY
  ? (process.env.TRUST_PROXY === 'true' ? true : (!isNaN(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY))
  : 1;
app.set('trust proxy', trustProxySetting);

// Güvenlik başlıkları (Helmet)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "http:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
}));

const { requireAuth } = require('./middleware/auth');

// CORS Yapılandırması (Production-ready whitelist ve same-origin koruması)
const rawCorsOrigin = process.env.CORS_ORIGIN;
let corsOptions;

if (rawCorsOrigin && rawCorsOrigin.trim() !== '*') {
  const allowedSet = new Set(
    rawCorsOrigin.split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean)
  );
  corsOptions = {
    origin(origin, callback) {
      if (!origin || allowedSet.has(origin.replace(/\/$/, ''))) {
        return callback(null, true);
      }
      return callback(new Error(`CORS engellendi: "${origin}" yetkili adres listesinde yok.`));
    },
    credentials: true,
  };
} else if (process.env.NODE_ENV === 'production' && !rawCorsOrigin) {
  corsOptions = {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      return callback(new Error('CORS engellendi: Üretim ortamında CORS_ORIGIN tanımlanmalıdır.'));
    },
    credentials: true,
  };
} else {
  corsOptions = {
    origin: true,
    credentials: true,
  };
}

app.use(cors(corsOptions));

// Girdi boyutu kısıtı (DoS koruması)
app.use(express.json({ limit: '2mb' }));

// Hız sınırlama (Rate Limiting) — Geliştirme/test ortamında limitler esnek tutulur
const isDev = process.env.NODE_ENV !== 'production';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, default: true },
  message: { error: 'Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin.' },
});
app.use('/api', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 2000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, default: true },
  message: { error: 'Çok fazla giriş denemesi yapıldı. Lütfen 15 dakika sonra tekrar deneyin.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/first-admin', authLimiter);

// Güvenli dosya erişimi: Yalnızca yetkili oturum veya kurumsal logo erişebilir
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
app.get('/uploads/:filename', (req, res, next) => {
  const safeFilename = path.basename(req.params.filename);

  // Giriş ekranı ve arayüz kurumsal logosu herkese açık gösterilebilir
  if (safeFilename.startsWith('logo-') || safeFilename.endsWith('.ico')) {
    const filePath = path.join(uploadDir, safeFilename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Dosya bulunamadı.' });
    }
    return res.sendFile(filePath);
  }

  // Özel belgeler (arıza fotoğrafları, sertifikalar, PDF raporları) için oturum doğrulaması
  return requireAuth(req, res, () => {
    const filePath = path.join(uploadDir, safeFilename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Dosya bulunamadı.' });
    }
    res.sendFile(filePath);
  });
});

// Frontend ve istemci varlıkları doğrudan sunulur
const frontendDir = path.resolve(__dirname, '../../');
app.get('/', (req, res) => {
  const fPath = path.join(frontendDir, 'fabrika-bakim.html');
  if (fs.existsSync(fPath)) return res.sendFile(fPath);
  res.json({ ok: true, message: 'Fabrika Bakım API çalışıyor.' });
});
app.get('/api-client.js', (req, res) => res.sendFile(path.join(frontendDir, 'api-client.js')));
app.get('/cmms-sync.js', (req, res) => res.sendFile(path.join(frontendDir, 'cmms-sync.js')));
app.get('/manifest.json', (req, res) => {
  const mPath = path.join(frontendDir, 'manifest.json');
  if (fs.existsSync(mPath)) return res.sendFile(mPath);
  res.status(404).end();
});
app.get('/sw.js', (req, res) => {
  const sPath = path.join(frontendDir, 'sw.js');
  if (fs.existsSync(sPath)) return res.sendFile(sPath);
  res.status(404).end();
});
app.get('/icon-192.png', (req, res) => res.sendFile(path.join(frontendDir, 'icon-192.png')));
app.get('/icon-512.png', (req, res) => res.sendFile(path.join(frontendDir, 'icon-512.png')));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(frontendDir, 'favicon.ico')));
app.get(['/Fabrika Bakım Yönetimi.ico', '/Fabrika%20Bak%C4%B1m%20Y%C3%B6netimi.ico'], (req, res) => {
  res.sendFile(path.join(frontendDir, 'Fabrika Bakım Yönetimi.ico'));
});

// ---- Modüller ----
app.use('/api/auth', require('./modules/auth/auth.routes'));
app.use('/api/users', require('./modules/users/users.routes'));
app.use('/api/asset-groups', require('./modules/asset-groups/asset-groups.routes'));
app.use('/api/assets', require('./modules/assets/assets.routes'));
app.use('/api/materials', require('./modules/materials/materials.routes'));
app.use('/api/stock', require('./modules/stock/stock.routes'));
app.use('/api/needs-list', require('./modules/needs-list/needs-list.routes'));
app.use('/api/suppliers', require('./modules/suppliers/suppliers.routes'));
app.use('/api/purchases', require('./modules/purchases/purchases.routes'));

app.use('/api/maintenance', require('./modules/maintenance/maintenance.routes'));
app.use('/api/faults', require('./modules/faults/faults.routes'));

app.use('/api/inspections', require('./modules/inspections/inspections.routes'));
app.use('/api/ext-maintenance', require('./modules/ext-maintenance/ext-maintenance.routes'));

app.use('/api/projects', require('./modules/projects/projects.routes'));
app.use('/api/settings', require('./modules/settings/settings.routes'));
app.use('/api/audit-logs', require('./modules/audit-logs/audit-logs.routes'));

app.get('/api/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ error: `Uç nokta bulunamadı: ${req.method} ${req.originalUrl}` });
});

// Merkezi hata yakalayıcı
app.use((err, req, res, next) => {
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Yüklenen dosya boyutu izin verilen sınırı (10 MB) aşıyor.' });
    }
    return res.status(400).json({ error: `Dosya yükleme hatası: ${err.message}` });
  }

  if (err.message && (err.message.includes('Desteklenmeyen dosya') || err.message.includes('kabul edilir'))) {
    console.warn(`[Dosya Yükleme Uyarısı] ${err.message}`);
    return res.status(400).json({ error: err.message });
  }

  if (err.code === '23505') {
    return res.status(400).json({ error: 'Bu kayıt veya benzersiz kod zaten mevcut.' });
  }

  if (err.code === '23503') {
    return res.status(400).json({ error: 'İlişkili kayıt bulunamadı veya bu kayda bağlı başka veriler var.' });
  }

  if (err.code === '22P02') {
    return res.status(400).json({ error: 'Geçersiz veri veya kimlik (ID) biçimi.' });
  }

  console.error('Hata:', err);

  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Sunucu hatası oluştu.' : err.message,
  });
});

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => console.log(`Fabrika Bakım API çalışıyor: http://localhost:${PORT}`));

// Zarif Kapatma (Graceful Shutdown)
function handleShutdown(signal) {
  console.log(`\n${signal} sinyali alındı. Sunucu güvenle kapatılıyor...`);
  server.close(async () => {
    console.log('HTTP sunucusu kapatıldı.');
    try {
      await pool.end();
      console.log('Veritabanı havuzu bağlantıları kapatıldı.');
    } catch (e) {
      console.error('Havuz kapatılırken hata:', e.message);
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

module.exports = { app, server };
