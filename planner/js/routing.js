/* Matriz de tiempos/distancias y geometría de rutas.
   Usa OSRM público si está disponible; si no, estimación por distancia geodésica. */
window.BTP = window.BTP || {};
(function (BTP) {
  'use strict';

  var U = BTP.util;
  var OSRM = 'https://router.project-osrm.org';
  var MAX_TABLE = 95; // el servidor público limita el tamaño de la tabla

  function coordString(points) {
    return points.map(function (p) { return p.lng.toFixed(6) + ',' + p.lat.toFixed(6); }).join(';');
  }

  /** Estimación offline: distancia geodésica × factor de desvío, a velocidad media. */
  function estimateMatrix(points, settings) {
    var n = points.length;
    var dur = [], dist = [];
    var factor = settings.detour || 1.25;
    var speed = settings.speedKmh || 80;
    for (var i = 0; i < n; i++) {
      dur.push(new Array(n));
      dist.push(new Array(n));
      for (var j = 0; j < n; j++) {
        if (i === j) { dur[i][j] = 0; dist[i][j] = 0; continue; }
        var km = U.haversine(points[i], points[j]) * factor;
        dist[i][j] = km;
        dur[i][j] = km / speed * 60; // minutos
      }
    }
    return { dur: dur, dist: dist, source: 'estimada' };
  }

  /**
   * Matriz NxN. Devuelve {dur (min), dist (km), source}.
   * Cae a la estimación si OSRM falla o hay demasiados puntos.
   */
  function matrix(points, settings) {
    if (!settings.useOsrm || points.length < 2 || points.length > MAX_TABLE) {
      return Promise.resolve(estimateMatrix(points, settings));
    }
    var url = OSRM + '/table/v1/driving/' + coordString(points) + '?annotations=duration,distance';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('OSRM table ' + r.status);
      return r.json();
    }).then(function (data) {
      if (!data || data.code !== 'Ok' || !data.durations) throw new Error('OSRM sin datos');
      var fallback = estimateMatrix(points, settings);
      var n = points.length;
      var dur = [], dist = [];
      for (var i = 0; i < n; i++) {
        dur.push(new Array(n));
        dist.push(new Array(n));
        for (var j = 0; j < n; j++) {
          var d = data.durations[i] ? data.durations[i][j] : null;
          var m = data.distances && data.distances[i] ? data.distances[i][j] : null;
          dur[i][j] = (d === null || d === undefined) ? fallback.dur[i][j] : d / 60;
          dist[i][j] = (m === null || m === undefined) ? fallback.dist[i][j] : m / 1000;
        }
      }
      return { dur: dur, dist: dist, source: 'OSRM' };
    }).catch(function (err) {
      console.warn('OSRM no disponible, se usa estimación:', err.message);
      return estimateMatrix(points, settings);
    });
  }

  /**
   * Geometría real de una ruta que pasa por todos los puntos, en [[lat,lng], ...].
   * Devuelve null si no se puede obtener (el mapa dibujará líneas rectas).
   */
  function routeGeometry(points, settings) {
    if (!settings.useOsrm || points.length < 2 || points.length > 25) return Promise.resolve(null);
    var url = OSRM + '/route/v1/driving/' + coordString(points) +
      '?overview=full&geometries=geojson&steps=false';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('OSRM route ' + r.status);
      return r.json();
    }).then(function (data) {
      if (!data || data.code !== 'Ok' || !data.routes || !data.routes.length) return null;
      return data.routes[0].geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
    }).catch(function (err) {
      console.warn('Geometría OSRM no disponible:', err.message);
      return null;
    });
  }

  BTP.routing = {
    matrix: matrix,
    estimateMatrix: estimateMatrix,
    routeGeometry: routeGeometry,
    MAX_TABLE: MAX_TABLE
  };
})(window.BTP);
