// ========================================
// RECORDER SERVICE WORKER
// ========================================
// Makes the recorder a cold-start-capable offline PWA. Strategy:
//   - Precache the recorder app shell on install.
//   - Navigations: network-first, falling back to the cached recorder shell so
//     a cold load works with no connectivity.
//   - Same-origin static assets: cache-first (and refresh the cache on hit).
//   - /api/* : always bypass the cache (recorder-store/recorder-sync own the
//     offline data model; the SW must never serve stale API responses).

const CACHE = 'recorder-shell-v1';

// App shell: everything needed to boot and record a match offline.
const SHELL = [
  '/recorder.html',
  '/style.css',
  '/recorder.css',
  '/recorder-aggregator.js',
  '/recorder-clock.js',
  '/recorder-store.js',
  '/recorder-sync.js',
  '/recorder.js',
  '/manifest.webmanifest',
  '/recorder-icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Tolerate individual 404s so one missing asset can't break install.
      .then((cache) => Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only handle same-origin requests; let the network handle cross-origin.
  if (url.origin !== self.location.origin) return;
  // Never cache API traffic — the offline store/sync layer owns that data.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations (address bar, reload, link) → network-first, shell fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/recorder.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/recorder.html').then((r) => r || caches.match(req)))
    );
    return;
  }

  // Static assets → cache-first, revalidate in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
