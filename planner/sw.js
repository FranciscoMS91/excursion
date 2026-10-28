/* Service worker: deja la aplicación instalada y utilizable sin cobertura.
   Los ficheros propios se sirven desde la caché; las teselas y los servicios
   externos se piden a la red y nunca bloquean el arranque. */

var VERSION = 'v21';
var CACHE = 'planificador-' + VERSION;

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/planner.css',
  './js/util.js',
  './js/store.js',
  './js/csv.js',
  './js/geocode.js',
  './js/routing.js',
  './js/optimize.js',
  './js/map.js',
  './js/itinerary.js',
  './js/clients.js',
  './js/basemap-data.js',
  './js/demo-data.js',
  './js/app.js',
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './vendor/xlsx.full.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './ejemplo-clientes.csv'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // addAll falla entero si un recurso falla: se añaden de uno en uno.
      .then(function (cache) {
        return Promise.all(SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function (err) {
            console.warn('[sw] no se pudo cachear', url, err);
          });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (claves) {
      return Promise.all(claves.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  var propio = url.origin === self.location.origin;

  if (!propio) {
    // Teselas, geocodificación y rutas: a la red, sin romper nada si no hay.
    e.respondWith(fetch(req).catch(function () { return Response.error(); }));
    return;
  }

  // Ficheros de la aplicación: red primero para tener siempre la última
  // versión, con la caché como respaldo cuando no hay cobertura.
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copia = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copia); });
      }
      return res;
    }).catch(function () {
      // Sin red: el sufijo ?v= de los recursos no debe impedir encontrarlos.
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match('./index.html', { ignoreSearch: true });
      });
    })
  );
});
