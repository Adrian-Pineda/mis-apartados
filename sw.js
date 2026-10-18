// Service worker: permite instalar la app y abrir su "cascarón" sin red. Los DATOS nunca se guardan en caché.
const VERSION = 'apartados-v3';
const CASCARON = ['./', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CASCARON)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const propio = url.origin === self.location.origin, cdn = url.hostname === 'cdn.jsdelivr.net';
  if (!propio && !cdn) return;                                // la API (script.google.com) no se intercepta
  e.respondWith(
    fetch(req).then(res => {                                  // primero red (para recibir actualizaciones), si falla, caché
      if (res.ok) { const copia = res.clone(); caches.open(VERSION).then(c => c.put(req, copia)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
