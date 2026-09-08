/**
 * Güvenli sayfalama (pagination) sınır doğrulayıcı ve ayrıştırıcı
 * @param {object} query - req.query
 * @param {number} defaultLimit - Varsayılan kayıt sayısı
 * @param {number} maxLimit - İzin verilen maksimum kayıt sayısı
 */
function parsePagination(query = {}, defaultLimit = 50, maxLimit = 200) {
  let limit = parseInt(query.limit, 10);
  if (isNaN(limit) || limit < 1) {
    limit = defaultLimit;
  } else if (limit > maxLimit) {
    limit = maxLimit;
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
