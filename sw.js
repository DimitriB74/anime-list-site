// Service worker : l'application s'ouvre même sans réseau.
// __VERSION__ est remplacé à la publication (scripts/publier.js) par une empreinte du contenu :
// une nouvelle version du site = un nouveau cache, l'ancien est supprimé.
const VERSION = '7b7164a36ba7';
const COQUILLE = [
  './', 'index.html', 'style.css', 'app.js', 'journal.js', 'mobile.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(COQUILLE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // GitHub, AniList, affiches : réseau direct
  if (url.pathname.endsWith('/animes.json')) {
    // Données : réseau d'abord (toujours la dernière publication), cache si hors connexion.
    e.respondWith(
      fetch(req).then((r) => {
        if (r.ok) { const copie = r.clone(); caches.open(VERSION).then((c) => c.put(req, copie)); }
        return r;
      }).catch(() => caches.match(req)));
    return;
  }
  // Fichiers de l'application : cache d'abord, le réseau reste la solution de repli.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((c) => c || fetch(req)));
});
