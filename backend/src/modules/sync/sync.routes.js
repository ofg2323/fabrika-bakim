const express = require('express');
const syncService = require('./sync.service');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

// SSE Stream — Canlı bildirim bağlantısı (Token başlıkta veya ?token= parametresinde iletilebilir)
router.get('/events', requireAuth, (req, res) => {
  syncService.addClient(req, res);
});

// Version kontrolü — Hızlı polling ve kontrol için
router.get('/version', requireAuth, (req, res) => {
  res.json(syncService.getStatus());
});

module.exports = router;
