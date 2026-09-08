// Fabrika Bakım Service Worker
const CACHE_NAME = 'cmms-cache-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  // API istekleri ve dosya yüklemeleri her zaman canlı sunucudan çekilir
  if (e.request.url.includes('/api/') || e.request.url.includes('/uploads/')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
