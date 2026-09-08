const jwt = require('jsonwebtoken');

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

// İstekte geçerli bir JWT olup olmadığını kontrol eder, varsa req.user'a ekler.
function requireAuth(req, res, next) {
  let token = null;
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    token = header.slice(7).trim();
  } else if (req.headers.cookie) {
    token = parseCookie(req.headers.cookie, 'cmms_token') || parseCookie(req.headers.cookie, 'token');
  }

  // URL query parametresinden token kabulü (özellikle PDF/resim görüntüleme için)
  if (!token && req.query && req.query.token) {
    token = String(req.query.token).trim();
  }

  if (!token) return res.status(401).json({ error: 'Oturum bulunamadı.' });

  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(500).json({ error: 'Sunucu güvenlik yapılandırma hatası.' });

  try {
    const payload = jwt.verify(token, secret);
    req.user = payload; // { id, name, role }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Oturum geçersiz veya süresi dolmuş.' });
  }
}

// Belirli rollerle sınırlı uçlar için: requireRole('Yönetici') veya requireRole('Yönetici','Teknisyen')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Oturum bulunamadı.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, parseCookie };
