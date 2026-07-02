// Pool Tracker service worker: app-shell cache + background sync flush.
importScripts('./config.js', './db.js', './sync.js');

// Bump this whenever any shell file changes — it forces the SW to reinstall
// and re-fetch the whole precache.
const CACHE = 'pool-tracker-v2';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './db.js',
  './sync.js',
  './config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Supabase calls go straight to the network (app handles offline queueing)
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  // cache-first shell, refresh in the background
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});

// Background sync: drain the queued readings even if the page is closed.
self.addEventListener('sync', (e) => {
  if (e.tag !== 'pool-sync') return;
  e.waitUntil(
    PoolSync.flush().then(async ({ sent }) => {
      const clients = await self.clients.matchAll();
      clients.forEach((c) => c.postMessage({ type: 'pool-sync-done', sent }));
    })
  );
});
