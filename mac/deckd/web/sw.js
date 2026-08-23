// Network first, cache only as a fallback.
//
// Deliberately not cache-first: the client is edited constantly and served
// fresh on every request, and a service worker that preferred its cache would
// quietly serve an old build back — the same class of problem as the browser
// cache that cost this project an evening earlier on. The cache exists so the
// app opens instantly and shows something useful when the Mac is asleep, not
// to save a request.
const CACHE = 'switchdeck-v4';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never touch the live paths: pairing, health and the socket must always go
  // to the Mac.
  if (event.request.method !== 'GET' || url.pathname.startsWith('/pair')
      || url.pathname.startsWith('/ws') || url.pathname.startsWith('/health')) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
