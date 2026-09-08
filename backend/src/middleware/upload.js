const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Yalnızca CMMS için zorunlu görsel ve belge uzantıları
const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.ico',
  '.pdf',
]);

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
]);

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
};

// Path traversal korumalı güvenli dosya silme
function safeUnlink(filename) {
  if (!filename) return;
  const safeName = path.basename(filename);
  const targetPath = path.join(UPLOAD_DIR, safeName);
  try {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Dosya silinirken hata oluştu:', err.message);
    }
  }
}

// Magic Byte (Dosya İmzası) Doğrulama
function verifyMagicBytes(filePath, ext) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (stat.size < 4) return false;

    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    const lowerExt = (ext || path.extname(filePath)).toLowerCase();

    // PDF: %PDF (0x25 0x50 0x44 0x46)
    if (lowerExt === '.pdf') {
      return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
    }

    // PNG: 0x89 0x50 0x4E 0x47
    if (lowerExt === '.png') {
      return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    }

    // JPEG / JPG: 0xFF 0xD8 0xFF
    if (lowerExt === '.jpg' || lowerExt === '.jpeg') {
      return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
    }

    // WEBP: RIFF (0..3) ve WEBP (8..11)
    if (lowerExt === '.webp') {
      const isRiff = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
      const isWebp = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
      return isRiff && isWebp;
    }

    // ICO: 0x00 0x00 0x01 0x00
    if (lowerExt === '.ico') {
      return buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00;
    }

    return false;
  } catch (err) {
    console.error('Magic byte doğrulama hatası:', err.message);
    return false;
  }
}

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
    console.warn(`[Dosya Yükleme Reddedildi] URL: ${req.method} ${req.originalUrl} | Dosya: "${file.originalname}" | Uzantı: "${ext || 'yok'}"`);
    return cb(new Error('Desteklenmeyen dosya uzantısı. Yalnızca görsel (JPG, PNG, WEBP, ICO) ve PDF belgeleri yüklenebilir.'), false);
  }

  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    console.warn(`[Dosya Yükleme Reddedildi] URL: ${req.method} ${req.originalUrl} | Dosya: "${file.originalname}" | Geçersiz MIME: "${file.mimetype}"`);
    return cb(new Error('Desteklenmeyen dosya türü. Yalnızca geçerli resim (JPG, PNG, WEBP, ICO) ve PDF kabul edilir.'), false);
  }

  cb(null, true);
}

const rawMulter = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB sınır
    files: 5,
  },
});

// Yüklenen dosyaların diskte magic bytes doğrulamasını yapan middleware
function validateMagicBytesMiddleware(req, res, next) {
  const files = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  if (req.files && typeof req.files === 'object' && !Array.isArray(req.files)) {
    Object.values(req.files).forEach(fArr => {
      if (Array.isArray(fArr)) files.push(...fArr);
      else if (fArr) files.push(fArr);
    });
  }

  for (const f of files) {
    const ext = path.extname(f.filename || f.originalname || '');
    const isValid = verifyMagicBytes(f.path, ext);
    if (!isValid) {
      safeUnlink(f.filename || path.basename(f.path));
      return res.status(400).json({
        error: `Güvenlik ihlali: "${f.originalname}" dosyasının gerçek içeriği (magic bytes) izin verilen bir görsel veya PDF formatı ile eşleşmiyor.`
      });
    }
  }

  next();
}

// Multer fonksiyonlarını otomatik magic byte doğrulamasıyla sarmala
const upload = {
  single(fieldName) {
    return [rawMulter.single(fieldName), validateMagicBytesMiddleware];
  },
  array(fieldName, maxCount) {
    return [rawMulter.array(fieldName, maxCount), validateMagicBytesMiddleware];
  },
  fields(fieldsArray) {
    return [rawMulter.fields(fieldsArray), validateMagicBytesMiddleware];
  },
};

module.exports = {
  upload,
  safeUnlink,
  verifyMagicBytes,
  UPLOAD_DIR,
};
