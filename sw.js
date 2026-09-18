/* Master Watchlist service worker.

   Deliberately conservative about what it caches:
   - the app shell is cached so the list opens instantly and works offline
   - Firestore and OMDb are NEVER cached; stale watch data or a cached quota
     error would be worse than no answer at all
   - poster art is cached opportunistically, because it is immutable and
     re-fetching it is the single biggest repeat cost on a phone
*/
const VERSION = 'wl-v1';
const SHELL = `${VERSION}-shell`;
const ART   = `${VERSION}-art`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      // individual failures must not abort the whole install
      .then(c => Promise.allSettled(SHELL_FILES.map(f => c.add(f))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

const isArt   = u => /m\.media-amazon\.com|image\.tmdb\.org/.test(u.hostname);
const isLive  = u => /firestore\.googleapis\.com|firebaseio|identitytoolkit|omdbapi\.com/.test(u.hostname);
const isFont  = u => /fonts\.(googleapis|gstatic)\.com/.test(u.hostname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // never serve watch data or API answers from cache
  if (isLive(url)) return;

  // posters: cache-first, they never change
  if (isArt(url)) {
    e.respondWith(
      caches.open(ART).then(async c => {
        const hit = await c.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok || res.type === 'opaque') c.put(req, res.clone());
          return res;
        } catch (err) {
          return hit || Response.error();
        }
      })
    );
    return;
  }

  // fonts: stale-while-revalidate
  if (isFont(url)) {
    e.respondWith(
      caches.open(SHELL).then(async c => {
        const hit = await c.match(req);
        const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // app shell: network-first so a deploy is picked up, cache as the fallback
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) caches.open(SHELL).then(c => c.put(req, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('./index.html')) || Response.error())
    );
  }
});
