const jwt = require('jsonwebtoken');

// İstekte geçerli bir JWT olup olmadığını kontrol eder, varsa req.user'a ekler.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
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

module.exports = { requireAuth, requireRole };
