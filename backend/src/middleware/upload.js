const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// MIME türü - uzantı eşleşmeleri (blob veya uzantısız yüklemeler için)
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/ico': '.ico',
  'image/x-ico': '.ico',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
};

// Güvenli MIME türleri ve uzantılar (HTML, SVG, çalıştırılabilir dosyalar engellenir)
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/ico',
  'image/x-ico',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.ico',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
  '.zip',
  '.rar',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname || '').toLowerCase();
    if (!ext && MIME_TO_EXT[file.mimetype]) {
      ext = MIME_TO_EXT[file.mimetype];
    }
    const randomName = crypto.randomBytes(16).toString('hex');
    cb(null, `${Date.now()}-${randomName}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  let ext = path.extname(file.originalname || '').toLowerCase();
  if (!ext && MIME_TO_EXT[file.mimetype]) {
    ext = MIME_TO_EXT[file.mimetype];
  }

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    console.warn(`[Dosya Yükleme Reddedildi] URL: ${req.method} ${req.originalUrl} | Dosya: "${file.originalname}" | Uzantı: "${ext || 'yok'}" | MIME: "${file.mimetype}"`);
    return cb(new Error('Desteklenmeyen dosya uzantısı. Yalnızca görsel (JPG, PNG, WEBP, ICO) ve belge (PDF, Excel, Word) dosyaları yüklenebilir.'), false);
  }

  const isAllowedMime = ALLOWED_MIME_TYPES.has(file.mimetype) || !file.mimetype;

  if (!isAllowedMime) {
    console.warn(`[Dosya Yükleme Reddedildi] URL: ${req.method} ${req.originalUrl} | Dosya: "${file.originalname}" | Geçersiz MIME: "${file.mimetype}"`);
    return cb(new Error('Desteklenmeyen dosya türü. Yalnızca resim veya geçerli çalışma belgeleri kabul edilir.'), false);
  }

  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB sınır
    files: 5,
  },
});

// Path traversal korumalı güvenli dosya silme
function safeUnlink(filename) {
  if (!filename) return;
  const safeName = path.basename(filename);
  const targetPath = path.join(UPLOAD_DIR, safeName);
  fs.unlink(targetPath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.error('Dosya silinirken hata oluştu:', err.message);
    }
  });
}

module.exports = {
  upload,
  safeUnlink,
  UPLOAD_DIR,
};
