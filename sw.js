// Fabrika Bakım Service Worker (PWA & Çevrimdışı Desteği)
const CACHE_NAME = 'cmms-cache-v2';

const PRECACHE_ASSETS = [
  '/',
  '/fabrika-bakim.html',
  '/manifest.json',
  '/api-client.js',
  '/cmms-sync.js',
  '/table-sort.js',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('PWA önbelleğe alma uyarısı:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Sadece GET isteklerini işle
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // API çağrıları ve yüklenen dosyalar her zaman doğrudan ağdan alınır
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }

  // Statik varlıklar ve navigasyon için Network-First stratejisi (offline durumunda önbellekten sunulur)
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }
        // Sayfa navigasyonu çevrimdışıysa ana sayfayı önbellekten döndür
        if (event.request.mode === 'navigate') {
          const fallback = await caches.match('/') || await caches.match('/fabrika-bakim.html');
          if (fallback) return fallback;
        }
        return new Response('Çevrimdışısınız. Lütfen internet / ağ bağlantınızı kontrol edin.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
        });
      })
  );
});
