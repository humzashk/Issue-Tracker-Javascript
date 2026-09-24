// LiveRates service worker — makes the site installable and usable offline.
//
//   • Page (HTML): network-first, so a new deploy shows up immediately;
//     falls back to the cached page when offline.
//   • /api/*: network-first; every good response is cached, so offline
//     visitors still see the last rates they loaded (the app flags this).
//   • CSS/JS/icons: stale-while-revalidate — instant from cache, refreshed
//     in the background. Asset URLs carry ?v=N, so a deploy that bumps N
//     is picked up on the next page load.
// Cross-origin requests (album art, audio previews) are left to the browser.
const VERSION = 'lr-v1';
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// `key` lets API responses be stored by path alone, so cache-busting query
// strings (the BTC game's ?cb=<timestamp>) don't pile up one entry per call.
async function networkFirst(request, { key = request, fallbackUrl } = {}) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(key)) || (fallbackUrl && (await cache.match(fallbackUrl)));
    if (hit) return hit;
    throw new Error('offline and not cached');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then(res => { if (res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => null);
  return hit || (await refresh) || fetch(request);
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/_vercel/')) return; // analytics beacons

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, { fallbackUrl: '/' }));
  } else if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, { key: url.origin + url.pathname }));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});
