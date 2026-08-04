/* Geocodificación con Nominatim (OpenStreetMap) + caché local y cola a 1 req/s. */
window.BTP = window.BTP || {};
(function (BTP) {
  'use strict';

  var U = BTP.util;
  var ENDPOINT = 'https://nominatim.openstreetmap.org/search';
  var MIN_INTERVAL = 1100; // Política de uso de Nominatim: máx. 1 petición/segundo.
  var lastCall = 0;

  function cacheKey(q) { return U.norm(q); }

  function fromCache(q) {
    var hit = BTP.store.state.geocache[cacheKey(q)];
    return hit || null;
  }

  function toCache(q, value) {
    BTP.store.state.geocache[cacheKey(q)] = value;
    BTP.store.saveGeocache();
  }

  function throttle() {
    var wait = Math.max(0, MIN_INTERVAL - (Date.now() - lastCall));
    lastCall = Date.now() + wait;
    return U.sleep(wait);
  }

  /**
   * Geocodifica una consulta libre restringida a la península ibérica.
   * Devuelve {lat, lng, label, precision}, o null si la dirección no existe.
   * Si falla la red, propaga el error para poder reintentar más tarde.
   */
  function geocodeStrict(query) {
    var q = String(query || '').trim();
    if (!q) return Promise.resolve(null);
    var cached = fromCache(q);
    if (cached) return Promise.resolve(cached);

    return throttle().then(function () {
      var url = ENDPOINT + '?format=jsonv2&limit=1&addressdetails=1' +
        '&countrycodes=es,pt,ad,gi' +
        '&accept-language=es' +
        '&q=' + encodeURIComponent(q);
      return fetch(url, { headers: { 'Accept': 'application/json' } });
    }).then(function (res) {
      if (!res.ok) throw new Error('Nominatim ' + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || !data.length) return null;
      var hit = data[0];
      var value = {
        lat: parseFloat(hit.lat),
        lng: parseFloat(hit.lon),
        label: hit.display_name,
        precision: precisionOf(hit)
      };
      toCache(q, value);
      return value;
    });
  }

  /** Versión tolerante: null tanto si no existe como si falla la red. */
  function geocode(query) {
    return geocodeStrict(query).catch(function (err) {
      console.warn('Geocodificación fallida:', query, err);
      return null;
    });
  }

  function precisionOf(hit) {
    var t = hit.type || '';
    var cls = hit.category || hit.class || '';
    if (cls === 'building' || t === 'house' || hit.address && hit.address.house_number) return 'exacta';
    if (t === 'road' || t === 'residential' || cls === 'highway') return 'calle';
    return 'aproximada';
  }

  /**
   * Geocodifica un cliente: primero dirección completa, si falla ciudad+provincia.
   * Muta el cliente y devuelve true si se ha resuelto.
   */
  function geocodeClient(c) {
    var full = BTP.store.fullAddress(c);
    var coarse = [c.postal, c.city, c.province, c.country].filter(Boolean).join(', ');

    function apply(hit, status) {
      c.lat = hit.lat; c.lng = hit.lng;
      c.geoStatus = status;
      c.geoLabel = hit.label;
      return true;
    }

    return geocodeStrict(full).then(function (hit) {
      if (hit) return apply(hit, hit.precision === 'aproximada' ? 'aproximado' : 'ok');
      if (!coarse || U.norm(coarse) === U.norm(full)) {
        c.geoStatus = 'error';   // la dirección no existe: no se reintenta
        return false;
      }
      return geocodeStrict(coarse).then(function (hit2) {
        if (hit2) return apply(hit2, 'aproximado');
        c.geoStatus = 'error';
        return false;
      });
    }).catch(function (err) {
      // Fallo de red: queda pendiente para volver a intentarlo.
      console.warn('Geocodificación no completada:', c.name, err);
      c.geoStatus = 'pendiente';
      return false;
    });
  }

  /**
   * Geocodifica en lote los clientes sin coordenadas.
   * onProgress(hechos, total, cliente) se llama tras cada uno.
   */
  function geocodeMissing(clients, onProgress) {
    var pending = clients.filter(function (c) {
      return (c.lat == null || c.lng == null) && c.geoStatus !== 'error' && BTP.store.fullAddress(c);
    });
    var total = pending.length, done = 0, ok = 0, redes = 0, seguidos = 0, abortado = false;
    if (!total) return Promise.resolve({ total: 0, ok: 0, red: 0, abortado: false });

    return pending.reduce(function (chain, c) {
      return chain.then(function () {
        if (abortado) return;
        return geocodeClient(c).then(function (success) {
          done++;
          if (success) { ok++; seguidos = 0; }
          else if (c.geoStatus === 'pendiente') { redes++; seguidos++; }
          else seguidos = 0;
          // Tres fallos de red seguidos: no tiene sentido seguir esperando.
          if (seguidos >= 3) abortado = true;
          BTP.store.saveClients();
          if (onProgress) onProgress(done, total, c);
        });
      });
    }, Promise.resolve()).then(function () {
      return { total: total, ok: ok, red: redes, abortado: abortado, hechos: done };
    });
  }

  BTP.geocode = {
    geocode: geocode,
    geocodeStrict: geocodeStrict,
    geocodeClient: geocodeClient,
    geocodeMissing: geocodeMissing
  };
})(window.BTP);
