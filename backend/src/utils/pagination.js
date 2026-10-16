/**
 * Güvenli sayfalama (pagination) sınır doğrulayıcı ve ayrıştırıcı
 * İstemci belirli bir limit talep etmediğinde modül sayfalarında tüm kayıtların
 * eksiksiz görüntülenebilmesi için varsayılan kayıt sayısı 10000 olarak ayarlanmıştır.
 * @param {object} query - req.query
 * @param {number} defaultLimit - Varsayılan kayıt sayısı
 * @param {number} maxLimit - İzin verilen maksimum kayıt sayısı (limit parametresi verildiğinde)
 */
function parsePagination(query = {}, defaultLimit = 10000, maxLimit = 200) {
  let limit;
  if (query.limit !== undefined && query.limit !== null && String(query.limit).trim() !== '') {
    limit = parseInt(query.limit, 10);
    if (isNaN(limit) || limit < 1) {
      limit = defaultLimit;
    } else if (limit > maxLimit && query.all !== 'true') {
      limit = maxLimit;
    }
  } else {
    // Limit parametresi gönderilmediğinde modül sayfalarında 50 sınırını kaldır, tüm kayıtları getir
    limit = defaultLimit;
  }

  let offset = parseInt(query.offset, 10);
  if (isNaN(offset) || offset < 0) {
    offset = 0;
  }

  return { limit, offset };
}

/**
 * Yanıta standart sayfalama HTTP başlıklarını ekler
 */
function setPaginationHeaders(res, totalCount, limit, offset) {
  if (!res) return;
  if (totalCount !== undefined && totalCount !== null) {
    res.setHeader('X-Total-Count', String(totalCount));
  }
  res.setHeader('X-Limit', String(limit));
  res.setHeader('X-Offset', String(offset));
}

module.exports = {
  parsePagination,
  setPaginationHeaders,
};
