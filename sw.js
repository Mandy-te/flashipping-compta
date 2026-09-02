/* Flashipping - Service Worker
   Met en cache la coquille de l'app pour un fonctionnement hors ligne. */

const CACHE = 'flashipping-v1';
const FICHIERS = [
  './',
  './index.html',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cles) =>
      Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Les appels a l'API ne sont jamais mis en cache :
  // hors ligne, app.js bascule tout seul sur la file d'attente.
  if (url.hostname.indexOf('script.google.com') !== -1) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((rep) => {
      if (rep) return rep;
      return fetch(e.request).then((net) => {
        const copie = net.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copie));
        return net;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
