// Offline support: the app and species data are served from cache when there is no
// network; map tiles that were viewed before stay available too.
// The build stamps a build id into the name (vite.config.js), so every deploy gets a fresh cache
// and files from older versions are removed instead of lingering as offline fallbacks.
const APP = 'app-__BUILD__';
const TILES = 'tiles-v1';

// The built JS/CSS have hashed names, so read them from index.html instead of listing them here.
async function precache() {
  const c = await caches.open(APP);
  const html = await (await fetch('./', { cache: 'no-cache' })).text();
  const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await c.addAll(['./', ...assets, 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'data/species.json', 'data/grid.json']);
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![APP, TILES].includes(k)).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'service.pdok.nl') {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // network first, so updates arrive as soon as there is a connection
  // Page loads all share one cached copy of the app, whatever query string they carry.
  const key = req.mode === 'navigate' ? './' : req;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) caches.open(APP).then((c) => c.put(key, res.clone()));
    return res;
  }).catch(() => caches.open(APP).then((c) => c.match(key, { ignoreSearch: true }))));
});
