const BUILD_HASH = '__BUILD_HASH__';
const CACHE_NAME = `delta-v-${BUILD_HASH}`;
const PRECACHE_URLS = [
  '/',
  `/client.js?v=${BUILD_HASH}`,
  `/style.css?v=${BUILD_HASH}`,
  '/favicon.svg',
  '/site.webmanifest',
  '/manifest.json',
  '/sitemap.xml',
  '/fonts/space-grotesk-latin.woff2',
  '/fonts/ibm-plex-mono-latin-400.woff2',
  '/fonts/ibm-plex-mono-latin-500.woff2',
  '/fonts/ibm-plex-mono-latin-600.woff2',
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

  // Never intercept non-GET requests, API routes, or any other dynamic
  // server endpoints that must always hit the network. Stale-while-
  // revalidate on these silently shows pre-wipe leaderboard / match
  // data and breaks any client expecting fresh authoritative state.
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/ws/') ||
    url.pathname === '/create' ||
    url.pathname.startsWith('/join/') ||
    url.pathname.startsWith('/quick-match') ||
    url.pathname.startsWith('/replay/') ||
    url.pathname === '/mcp' ||
    url.pathname.startsWith('/healthz') ||
    url.pathname.startsWith('/health') ||
    url.pathname.startsWith('/status') ||
    url.pathname === '/error' ||
    url.pathname === '/telemetry' ||
    url.pathname === '/version.json'
  ) {
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
