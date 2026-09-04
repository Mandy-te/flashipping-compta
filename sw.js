/* Flashipping - Service Worker
   Strategie : reseau d'abord, cache en secours.
   L'app se met a jour des qu'il y a du reseau, et reste
   utilisable hors ligne grace au dernier cache connu. */

const CACHE = 'flashipping-v3';
const FICHIERS = [
  './',
  './index.html',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FICHIERS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(
        cles.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Les appels a l'API ne passent jamais par le cache :
  // hors ligne, app.js bascule tout seul sur la file d'attente.
  if (url.hostname.indexOf('script.google.com') !== -1) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then((net) => {
        // succes reseau : on rafraichit le cache au passage
        const copie = net.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copie));
        return net;
      })
      .catch(() => {
        // hors ligne : on sert la derniere version connue
        return caches.match(e.request)
          .then((rep) => rep || caches.match('./index.html'));
      })
  );
});