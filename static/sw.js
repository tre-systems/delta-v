const BUILD_HASH = '__BUILD_HASH__';
const CACHE_NAME = `delta-v-${BUILD_HASH}`;
const PRECACHE_URLS = [
  '/',
  `/client.js?v=${BUILD_HASH}`,
  `/style.css?v=${BUILD_HASH}`,
  `/styles/base.css?v=${BUILD_HASH}`,
  `/styles/menu.css?v=${BUILD_HASH}`,
  `/styles/hud.css?v=${BUILD_HASH}`,
  `/styles/overlays.css?v=${BUILD_HASH}`,
  `/styles/systems.css?v=${BUILD_HASH}`,
  `/styles/responsive.css?v=${BUILD_HASH}`,
  '/favicon.svg',
  '/site.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll().then((clients) =>
        clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }))
      ))
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept non-GET requests or API routes
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/ws/') ||
    url.pathname === '/create' ||
    url.pathname.startsWith('/join/') ||
    url.pathname === '/error' ||
    url.pathname === '/telemetry'
  ) {
    return;
  }

  // Google Fonts: cache-first
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached || fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
      )
    );
    return;
  }

  // Navigation (HTML): network-first, fallback to cache for offline support
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
