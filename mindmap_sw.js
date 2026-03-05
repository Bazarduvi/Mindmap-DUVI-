// ══════════════════════════════════════
//  MINDMAP DUVI OS · Service Worker v2.0
// ══════════════════════════════════════

const CACHE_NAME = 'mindmap-duvi-os-v2';
const OFFLINE_URL = './index.html';

const ASSETS_TO_CACHE = [
  './index.html',
  './manifest.json',
  './icon.png',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@300;400;500;700;900&family=JetBrains+Mono:wght@400;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.6.1/mermaid.min.js'
];

// ── INSTALL: pre-cache assets ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Cache local assets (critical), external ones best-effort
        return cache.addAll([OFFLINE_URL]).then(() => {
          const externalAssets = ASSETS_TO_CACHE.filter(url => url.startsWith('http'));
          return Promise.allSettled(
            externalAssets.map(url =>
              fetch(url, { mode: 'no-cors' })
                .then(res => cache.put(url, res))
                .catch(() => {}) // silently skip if unavailable
            )
          );
        });
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: network-first for API calls, cache-first for assets ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept API calls (Groq, Gemini, Google APIs)
  const isAPICall = [
    'api.groq.com',
    'generativelanguage.googleapis.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
  ].some(domain => url.hostname.includes(domain));

  if (isAPICall) {
    // For fonts: cache-first; for AI APIs: network-only
    if (url.hostname.includes('fonts')) {
      event.respondWith(
        caches.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            return response;
          }).catch(() => cached);
        })
      );
    }
    // AI API calls: always network, no cache
    return;
  }

  // Navigation requests: network-first, fallback to offline page
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() =>
          caches.match(OFFLINE_URL).then(cached => {
            if (cached) return cached;
            return new Response('<h1>Offline — Abre MindMap Duvi OS conectado al menos una vez</h1>', {
              headers: { 'Content-Type': 'text/html' }
            });
          })
        )
    );
    return;
  }

  // Static assets (JS, CSS, images): cache-first, then network
  if (['script', 'style', 'image', 'font'].includes(event.request.destination)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request)
          .then(response => {
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            return response;
          })
          .catch(() => cached || new Response('', { status: 503 }));
      })
    );
    return;
  }

  // Default: network with cache fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ── BACKGROUND SYNC: retry failed requests ──
self.addEventListener('sync', event => {
  if (event.tag === 'mindmap-sync') {
    console.log('[DuviMind SW] Background sync triggered');
  }
});

// ── MESSAGE: force update from app ──
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0]?.postMessage({ cleared: true });
    });
  }
});
